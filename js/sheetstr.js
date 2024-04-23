var ws = undefined

function convertEventToDataArray(event) {
  let data = []
  event.tags

  for (tagData of event.tags) {
    if (tagData[0]== "data")
      data.push(tagData.slice(1))
  }

  return data
}

async function convertDataArrayToEvent(univerData) {
  let tags = [["d","SheetStr Demo"], ["alt","A spreadsheet"]]
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

async function fetchSpreadSheet(createNewSheet) {
  let relay = "wss://nostr.mom"
  let pubkey = await window.nostr.getPublicKey()

  filters = [
    {
      "authors":[pubkey],
      "kinds":[35337],
      "#d":["SheetStr Demo"],
      "limit":1
    }
  ]

  let eventIds = new Set()

  await observe(
    relay, 
    filters,
    (state) => {
      console.log(relay, state)
    },
    (event) => { 
      console.log("Event Received", relay, event)
      if (!eventIds.has(event.id)) {
        eventIds.add(event.id)
        createNewSheet(convertEventToDataArray(event))
      }
    }, 
    (eventId, inserted, message) => {
      console.log("Event Ack", relay, eventId, inserted, message)
    },
    () => {
      console.log("EOSE", relay)

      if (eventIds.size == 0) {
        createNewSheet([])
      }
    }
  )
}

async function saveSpreadSheet(univerData) {
  let eventStr = JSON.stringify(['EVENT', await convertDataArrayToEvent(univerData)])
  ws.send(eventStr)
  console.log("Sending new Event", ws, eventStr)
}

async function observe(relay, filters, onState, onNewEvent, onOk, onEOSE) {
  if (ws) {
    if (ws.readyState <= 1)
      ws.close()
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
        ws.send(request)
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
            ws.close(); 
          }
        },
        (reason) => {
          onState("Auth Fail")
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
            ws.send(JSON.stringify(['REQ', sub.id, sub.filter]))
          }
        } else {
          onState("Auth Fail")
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
        } else if (subState.filter.limit && subState.counter >= subState.filter.limit) {

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
      if (alldone) {
        ws.close(); 
      }
    }
  }
  ws.onerror = (err, event) => {
    console.log("WS Error", relay, err, event)
    ws.close(); 
  }
  ws.onclose = (event) => {
    console.log("WS Close", relay, event)
    setTimeout(() => { observe(relay, filters, onState, onNewEvent, onOk, onEOSE) }, 50)
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