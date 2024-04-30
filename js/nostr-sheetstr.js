var ws = undefined
var eventIds = new Set()
var lastEvent = undefined
var tentatives = 0

function convertEventToDataArray(event) {
  let data = []
  event.tags

  for (tagData of event.tags) {
    if (tagData[0]== "data")
      data.push(tagData.slice(1))
  }

  return data
}

async function convertDataArrayToEvent(dTag, univerData) {
  let tags = [["d",dTag], ["alt","A spreadsheet"]]
  for (tagData of univerData) {
    tags.push(["data", ...tagData])
  }

  let event = {
    kind: 35337, 
    content: "",
    tags: tags,
  };

  let evt = await nostrSign(event)
  console.log(JSON.stringify(evt))
  return evt
}

async function fetchAllSpreadsheets(author, onReady) {
  tentatives = 0
  let relay = "wss://nostr.mom"

  let filters = [
    {
      "authors":[author],
      "kinds":[35337],
      "limit":200
    }
  ]

  var eventDtags = new Set()

  await observe(
    relay, 
    filters,
    (state) => {
      console.log(relay, state)
    },
    (event) => { 
      console.log("Event Received", relay, event)

      let dTag = event.tags.find(([k, v]) => k === "d")[1]

      if (!eventDtags.has(dTag) && (!lastEvent || event.created_at > lastEvent.created_at)) {
        console.log("Loading", relay, event)
        eventDtags.add(dTag)
        onReady(dTag, event.created_at)
      } else {
        console.log("Already has event", relay, event)
      }
    }, 
    (eventId, inserted, message) => {
      console.log("Event Ack", relay, eventId, inserted, message)
    },
    () => {
      console.log("EOSE", relay)
    }
  )
}

async function fetchSpreadSheet(author, dTag, createNewSheet) {
  tentatives = 0
  let relay = "wss://nostr.mom"

  let filters = [
    {
      "authors":[author],
      "kinds":[35337],
      "#d":[dTag],
      "limit":1
    }
  ]

  await observe(
    relay, 
    filters,
    (state) => {
      console.log(relay, state)
    },
    (event) => { 
      console.log("Event Received", relay, event)
      if (!eventIds.has(event.id) && (!lastEvent || event.created_at > lastEvent.created_at)) {
        console.log("Loading", relay, event)
        eventIds.add(event.id)
        createNewSheet(dTag, convertEventToDataArray(event))
      } else {
        console.log("Already has event", relay, event)
      }
    }, 
    (eventId, inserted, message) => {
      console.log("Event Ack", relay, eventId, inserted, message)
    },
    () => {
      console.log("EOSE", relay)

      if (eventIds.size == 0) {
        createNewSheet(dTag, [])
      }
    }
  )
}

async function deleteSpreadSheet(author, dTag) {
  let tags = [["a","35337:"+author+":"+dTag]]
  let event = {
    kind: 5, 
    content: "",
    tags: tags,
  };

  let evt = await nostrSign(event)
  console.log(JSON.stringify(evt))

  let eventStr = JSON.stringify(['EVENT', evt])
  ws.send(eventStr)
  console.log("Deleting Event", ws, eventStr)
}

async function saveSpreadSheet(author, dTag, univerData) {
  let event = await convertDataArrayToEvent(dTag, univerData)
  eventIds.add(event.id)
  lastEvent = event

  let eventStr = JSON.stringify(['EVENT', event])
  ws.send(eventStr)
  console.log("Sending new Event", ws, eventStr)
}

async function observe(relay, filters, onState, onNewEvent, onOk, onEOSE) {
  if (ws) {
    if (ws.readyState <= 1) 
      ws.close()

    lastEvent = undefined
    eventIds = new Set()
    ws = undefined
  }

  ws = new WebSocket(relay)
  
  let isAuthenticating = false

  onState("Starting")

  const subscriptions = Object.fromEntries(filters.map ( (filter, index) => {
    let id = "MYSUB"+index
    return [ 
      id, {
        id: id,
        counter: 0,
        eoseSessionCounter: 0,
        okCounter: 0,
        lastEvent: undefined,
        done: false,
        filter: { ...filter },
        eventIds: new Set()
      }
    ]
  }))

  // connected
  ws.onopen = () => {
    if (Object.keys(subscriptions).length > 0) {
      onState("Querying")
      for (const [key, sub] of Object.entries(subscriptions)) {
        let request = JSON.stringify(['REQ', sub.id, sub.filter])
        console.log(request)
        if (ws) {
          ws.send(request)
        }
      }
    }
  }

  // Listen for messages
  ws.onmessage = (str) => {
    const messageArray = JSON.parse(str.data)
    const [msgType] = messageArray

    if (msgType === 'AUTH') {
      isAuthenticating = true
      signNostrAuthEvent(relay, messageArray[1]).then(
        (event) => {
          if (event) {
            ws.send(JSON.stringify(['AUTH', event]))
          } else {
            onState("Auth Fail")
            if (ws)
              ws.close(); 
          }
        },
        (reason) => {
          onState("Auth Fail")
          if (ws)
            ws.close(); 
        },
      ) 
    }

    if (msgType === 'OK') {
      if (isAuthenticating) {
        isAuthenticating = false
        if (messageArray[2]) {
          onState("Auth Ok")

          // Refresh filters
          for (const [key, sub] of Object.entries(subscriptions)) {
            if (ws) {
              ws.send(JSON.stringify(['REQ', sub.id, sub.filter]))
            }
          }
        } else {
          onState("Auth Fail")
          if (ws)
            ws.close(); 
        }
      } else {
        onOk(messageArray[1], messageArray[2], messageArray[3])
      }
    } 

    // event messages
    if (msgType === 'EVENT') {
      const subState = subscriptions[messageArray[1]]
      const event = messageArray[2]

      try { 
        if (!matchFilter(subState.filter, event)) {
          console.log("Didn't match filter", relay, event, subState.filter)
        } else if (subState.eventIds.has(event.id)) {
          console.log("Duplicated", relay, event, subState.filter)
        } else {
          if (!subState.lastEvent || event.created_at < subState.lastEvent.created_at) {
            subState.lastEvent = event
          }

          subState.eventIds.add(event.id)
          subState.counter++
          subState.eoseSessionCounter++

          onNewEvent(event)
        }
      } catch(err) {
        console.log("Minor Error", relay, err, event)
      }
    }

    if (msgType === 'EOSE') {
      const subState = subscriptions[messageArray[1]]
      onEOSE()
    }

    if (msgType === 'CLOSED') {
      const subState = subscriptions[messageArray[1]]

      console.log("WS Closed", relay, subState,  messageArray[2])

      subState.done = true
    
      let alldone = Object.values(subscriptions).every(filter => filter.done === true);
      if (alldone && ws) {
        ws.close(); 
      }
    }
  }
  ws.onerror = (err, event) => {
    console.log("WS Error", relay, err, event)
    if (ws)
      ws.close(); 
  }
  ws.onclose = (event) => {
    console.log("WS Close", relay, event)
    if (tentatives > 5) {
      setTimeout(() => { observe(relay, filters, onState, onNewEvent, onOk, onEOSE) }, 150)
    }
    tentatives++

    ws = undefined
  } 

  return ws
}

async function signNostrAuthEvent(relay, auth_challenge) {
  let event = {
    kind: 22242, 
    content: "",
    tags: [
      ["relay", relay],
      ["challenge", auth_challenge]
    ],
  };

  return await nostrSign(event)
}