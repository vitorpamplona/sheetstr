var ws = undefined
var eventIds = new Set()
var lastEvent = undefined
var tentatives = 0

async function convertEventToDataArray(event) {
  let data = []

  for (tagData of event.tags) {
    if (tagData[0]== "data")
      data.push(tagData.slice(1))
  }

  try {
    let myPubKey = await window.nostr.getPublicKey()
    let ciphertext = event.tags.find(([k, v]) => k === "p" && v === myPubKey)[3]
  
    console.log("cypher", ciphertext)
  
    if (ciphertext) {
      let thisVersionsPrivateKeyInHex = window.nostr.nip44.decrypt(event.pubkey, ciphertext)
      let conversationKey = window.NostrTools.nip44.v2.utils.getConversationKey(thisVersionsPrivateKeyInHex, bytesToHex(thisVersionsPublicKey))

      console.log("Convesation Key", conversationKey)

      let privateTags = window.NostrTools.nip44.v2.decrypt(event.content, conversationKey) 
    
      console.log("Private data", privateTags)

      for (tagData of privateTags) {
        if (tagData[0]== "data") {
          console.log("Private data", tagData.slice[1])
          data.push(tagData.slice(1))
        }
      }
    } 
  } catch (e) {
    // not logged in
  }


  return data
}

async function convertDataArrayToEvent(dTag, shareWith, univerData) {
  let thisVersionsPrivateKey = window.NostrTools.generateSecretKey()
  let thisVersionsPublicKeyHex = window.NostrTools.getPublicKey(thisVersionsPrivateKey)
  let thisVersionsPrivateKeyInHex = bytesToHex(thisVersionsPrivateKey)

  console.log("New keys", thisVersionsPrivateKey, thisVersionsPublicKeyHex)

  let conversationKey = window.NostrTools.nip44.v2.utils.getConversationKey(thisVersionsPrivateKeyInHex, thisVersionsPublicKeyHex)

  let tags = [
    ["d",dTag], 
    ["alt","A spreadsheet"]
  ]
  for (pubkey of shareWith) {
    tags.push(["p", pubkey, "", await window.nostr.nip44.encrypt(pubkey, thisVersionsPrivateKeyInHex)])
  }
  for (tagData of univerData) {
    tags.push(["data", ...tagData])
  }

  let privateTags = []
  for (tagData of univerData) {
    privateTags.push(["data", ...tagData])
  }

  let content = window.NostrTools.nip44.v2.encrypt(JSON.stringify(privateTags), conversationKey) 

  let event = {
    kind: 35337, 
    content: content,
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
        onReady(event.id, dTag, event.created_at)
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

async function fetchSpreadSheet(author, dTag, createNewSheet, newAuthorMetadata) {
  tentatives = 0
  let relay = "wss://nostr.mom"

  let filters = [
    {
      "authors":[author],
      "kinds":[35337],
      "#d":[dTag],
      "limit":1
    }, {
      "authors":[author],
      "kinds":[0]
    }
  ]

  await observe(
    relay, 
    filters,
    (state) => {
      console.log(relay, state)
    },
    async (event) => { 
      console.log("Event Received", relay, event)
      if (event.kind == 0) {
        newAuthorMetadata(event.pubkey, JSON.parse(event.content).name)
      } else if (event.kind == 35337) {
        let shares = [event.pubkey, ...event.tags.filter(([k, v]) => k === "p").map(([k, v]) => v)]

        if (!eventIds.has(event.id) && (!lastEvent || event.created_at > lastEvent.created_at)) {
          console.log("Loading", relay, event)
          eventIds.add(event.id)
          createNewSheet(dTag, shares, await convertEventToDataArray(event))
        } else {
          console.log("Already has event", relay, event)
        }
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

async function deleteSpreadSheet(id, author, dTag) {
  let tags = [["e", id], ["a","35337:"+author+":"+dTag]]
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

async function saveSpreadSheet(author, dTag, shareWith, univerData) {
  let event = await convertDataArrayToEvent(dTag, shareWith, univerData)
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
  ws.onopen = (evt) => {
    if (Object.keys(subscriptions).length > 0) {
      onState("Querying")
      for (const [key, sub] of Object.entries(subscriptions)) {
        let request = JSON.stringify(['REQ', sub.id, sub.filter])
        console.log(request)
        evt.target.send(request)
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
            str.target.send(JSON.stringify(['AUTH', event]))
          } else {
            onState("Auth Fail")
            str.target.close(); 
          }
        },
        (reason) => {
          onState("Auth Fail")
          str.target.close(); 
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
            str.target.send(JSON.stringify(['REQ', sub.id, sub.filter]))
          }
        } else {
          onState("Auth Fail")
          str.target.close(); 
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
      if (alldone) {
        str.target.close(); 
      }
    }
  }
  ws.onerror = (event) => {
    console.log("WS Error", relay, event)
    event.target.close(); 
  }
  ws.onclose = (event) => {
    console.log("WS Close", relay, event)
    if (tentatives > 5) {
      setTimeout(() => { observe(relay, filters, onState, onNewEvent, onOk, onEOSE) }, 150)
    }
    tentatives++

    if (ws == event.target)
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