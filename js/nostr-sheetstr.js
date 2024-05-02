var ws = undefined
var eventIds = new Set()
var lastEvent = undefined
var tentatives = 0
var userMetatada = new Map()

async function convertEventToDataArray(event) {
  let data = []

  for (tagData of event.tags) {
    if (tagData[0]== "data")
      data.push(tagData.slice(1))
  }

  let privateTags = await decryptPrivateTags(event)

  if (privateTags) {
    for (tagData of privateTags) {
      if (tagData[0]== "data") {
        console.log("Private data", tagData)
        data.push(tagData.slice(1))
      }
    }
  }

  return data
}

async function decryptSharedPrivateKey(event) {
  try {
    let myPubKey = await window.nostr.getPublicKey()
    let ciphertext = event.tags.find(([k, v]) => k === "p" && v === myPubKey)[3]
  
    if (ciphertext) {
      return await window.nostr.nip44.decrypt(event.pubkey, ciphertext)
    } 
  } catch (e) {
    // not logged in
    return undefined
  }
}

async function decryptPrivateTags(thisVersionsPrivateKeyInHex, event) {
  try {
    if (thisVersionsPrivateKeyInHex) {
      let thisVersionsPublicKeyHex = window.NostrTools.getPublicKey(hexToBytes(thisVersionsPrivateKeyInHex))

      let conversationKey = window.NostrTools.nip44.v2.utils.getConversationKey(thisVersionsPrivateKeyInHex, thisVersionsPublicKeyHex)
      return JSON.parse(window.NostrTools.nip44.v2.decrypt(event.content, conversationKey))
    } else {
      return undefined
    }
  } catch (e) {
    // not logged in
    return undefined
  }
}

async function decryptPrivateTags(event) {
  try {
    let thisVersionsPrivateKeyInHex = await decryptSharedPrivateKey(event)
    
    if (thisVersionsPrivateKeyInHex) {
      await decryptPrivateTags(thisVersionsPrivateKeyInHex, event)
    } else {
      return undefined
    }
  } catch (e) {
    // not logged in
    return undefined
  }
}

async function expandEvent(event) {
  let dTag = event.tags.find(([k, v]) => k === "d")[1]
  let team = event.tags.filter(([k, v]) => k === "p").map(it => it[1])
  
  let loggedIn = undefined
  if (window.nostr) { 
    loggedIn = await window.nostr.getPublicKey()
  }

  let publicTitleTag = event.tags.find(([k, v]) => k === "title")
  let sharedPrivateKeyHex = await decryptSharedPrivateKey(event)
  let sharedPublicKeyHex = undefined
  if (sharedPrivateKeyHex) {
    sharedPublicKeyHex = window.NostrTools.getPublicKey(hexToBytes(sharedPrivateKeyHex))
  }
  let privateTags = await decryptPrivateTags(sharedPrivateKeyHex, event)
  let privateSignerPubKeyTag = undefined
  let privateTitleTag = undefined
  if (privateTags) {
    privateTitleTag = privateTags.find(([k, v]) => k === "title")
    privateSignerPubKeyTag = privateTags.find(([k, v]) => k === "signer")
  }
  let title = dTag
  if (publicTitleTag) {
    title = publicTitleTag[1]
  }
  if (privateTitleTag) {
    title = privateTitleTag[1]
  }

  return {
    event: event, 
    dTag: dTag,
    address: event.kind + ":" + event.pubkey + ":" + dTag,
    title: title,
    privateTags: privateTags, 
    sharedPrivateKeyHex: sharedPrivateKeyHex,
    declaredSignerPubKey: undefined,
    team: team,
    hasPrivateCells: privateTags != undefined,
    canEdit: event.pubkey == loggedIn || event.pubkey == sharedPublicKeyHex,
  }
}

async function convertDataArrayToEvent(dTag, shareWith, univerData) {
  let thisVersionsPrivateKey = window.NostrTools.generateSecretKey()
  let thisVersionsPublicKeyHex = window.NostrTools.getPublicKey(thisVersionsPrivateKey)
  let thisVersionsPrivateKeyInHex = bytesToHex(thisVersionsPrivateKey)

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

async function fetchAllSpreadsheets(author, onReady, newUserMetadata) {
  tentatives = 0
  let relay = "wss://nostr.mom"

  addUserMetadataIfItDoesntExist(author)

  let filters = [
    {
      "authors":[author],
      "kinds":[35337],
      "limit":200
    }, 
    {
      "#p":[author],
      "kinds":[35337],
      "limit":200
    }, {
      "authors": Array.from(userMetatada.keys()),
      "kinds":[0]
    }
  ]

  let subscriptions = createSubscriptions(filters)

  console.log("Subs", subscriptions)

  await observe(
    relay, 
    subscriptions,
    (state) => {
      console.log(relay, state)
    },
    async (event) => { 
      console.log("Event Received", relay, event)
      if (event.kind == 0) {
        newUserMetadata(event.pubkey, JSON.parse(event.content))
      } else if (event.kind == 35337) {
        loadAllKeysFromSheet(event)
        onReady(await expandEvent(event))
      }
    }, 
    (eventId, inserted, message) => {
      console.log("Event Ack", relay, eventId, inserted, message)
    },
    () => {
      console.log("EOSE", relay)

      if (subscriptions["MYSUB2"].filter.authors.length != userMetatada.size) {
        subscriptions["MYSUB2"].filter = {
          "authors": Array.from(userMetatada.keys()),
          "kinds":[0]
        }
        updateSubscriptions(ws, subscriptions)
      }
    }
  )
}

function createSubscriptions(filters) {
  return Object.fromEntries(filters.map ( (filter, index) => {
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
}

function loadAllKeysFromSheet(event) {
  [event.pubkey, ...event.tags.filter(([k, v]) => k === "p").map(([k, v]) => v)].forEach(key => {
    addUserMetadataIfItDoesntExist(key)
  })
}

function addUserMetadataIfItDoesntExist(pubkey) {
  if (!userMetatada.has(pubkey)) {
    userMetatada.set(pubkey, undefined)
  }
}

async function fetchSpreadSheet(author, dTag, createNewSheet, newUserMetadata) {
  tentatives = 0
  let relay = "wss://nostr.mom"

  addUserMetadataIfItDoesntExist(author)

  const filters = [
    {
      "authors":[author],
      "kinds":[35337],
      "#d":[dTag],
      "limit":1
    }, {
      "authors": Array.from(userMetatada.keys()),
      "kinds":[0]
    }
  ]

  let subscriptions = createSubscriptions(filters)

  await observe(
    relay, 
    subscriptions,
    (state) => {
      console.log(relay, state)
    },
    async (event) => { 
      console.log("Event Received", relay, event)
      if (event.kind == 0) {
        newUserMetadata(event.pubkey, JSON.parse(event.content))
      } else if (event.kind == 35337) {
        if (!eventIds.has(event.id) && (!lastEvent || event.created_at > lastEvent.created_at)) {
          console.log("Loading", relay, event)
          eventIds.add(event.id)
          loadAllKeysFromSheet(event)
          let shares = [event.pubkey, ...event.tags.filter(([k, v]) => k === "p").map(([k, v]) => v)]
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

      if (subscriptions["MYSUB1"].filter.authors.length != userMetatada.size) {
        subscriptions["MYSUB1"].filter = {
          "authors": Array.from(userMetatada.keys()),
          "kinds":[0]
        }
        updateSubscriptions(ws, subscriptions)
      }

      if (eventIds.size == 0) {
        createNewSheet(dTag, [], [])
      }
    }
  )
}

async function deleteSpreadSheet(expandEvent) {
  let event = {
    kind: 5, 
    created_at: Math.floor(Date.now() / 1000),
    content: "",
    tags: [["e", expandEvent.event.id], ["a",expandEvent.address]],
  };

  let loggedInUser = window.nostr.getPublicKey()

  if (loggedInUser == expandEvent.event.pubkey) {
    let evt = await nostrSign(event)
    console.log(JSON.stringify(evt))
  
    let eventStr = JSON.stringify(['EVENT', evt])
    ws.send(eventStr)
    console.log("Deleting Event", ws, eventStr)
  } else if (expandEvent.sharedPrivateKeyHex) {
    // if it has a valid shared key for this event. 
    let privateKeyBytes = hexToBytes(expandEvent.sharedPrivateKeyHex)
    let eventSharedPubKey = window.NostrTools.getPublicKey(privateKeyBytes)
    if (expandEvent.event.pubkey == eventSharedPubKey) {
      let evt = window.NostrTools.finalizeEvent(event, privateKeyBytes)
      console.log(JSON.stringify(evt))
  
      let eventStr = JSON.stringify(['EVENT', evt])
      ws.send(eventStr)
      console.log("Deleting Event using shared key", ws, eventStr)
    }
  }
}

async function saveSpreadSheet(author, dTag, shareWith, univerData) {
  let event = await convertDataArrayToEvent(dTag, shareWith, univerData)
  eventIds.add(event.id)
  lastEvent = event

  loadAllKeysFromSheet(event)

  let eventStr = JSON.stringify(['EVENT', event])
  ws.send(eventStr)
  console.log("Sending new Event", ws, eventStr)
}

function updateSubscriptions(websocket, subscriptions) {
  if (Object.keys(subscriptions).length > 0) {
    for (const [key, sub] of Object.entries(subscriptions)) {
      let request = JSON.stringify(['REQ', sub.id, sub.filter])
      console.log(request)
      websocket.send(request)
    }
  }
}

async function observe(relay, subscriptions, onState, onNewEvent, onOk, onEOSE) {
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

  // connected
  ws.onopen = (evt) => {
    if (Object.keys(subscriptions).length > 0) {
      onState("Querying")
      updateSubscriptions(evt.target, subscriptions)
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
      setTimeout(() => { observe(relay, subscriptions, onState, onNewEvent, onOk, onEOSE) }, 150)
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