var ws = undefined
var eventIds = new Set()
var lastEvent = undefined
var tentatives = 0
var userMetatada = new Map()

async function convertEventToDataArray(tags, privateTags) {
  let data = []

  for (tagData of tags) {
    if (tagData[0]== "data")
      data.push(tagData.slice(1))
  }

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

async function decryptMySharedPrivateKey(event) {
  try {
    let myPubKey = await window.nostr.getPublicKey()
    decryptMySharedPrivateKey(myPubKey, event)
  } catch (e) {
    // not logged in
    return undefined
  }
}

async function decryptMySharedPrivateKey(myPubKey, event) {
  try {
    let ciphertext = event.tags.find(([k, v]) => k === "p" && v === myPubKey)[3]
  
    if (ciphertext) {
      return await window.nostr.nip44.decrypt(event.pubkey, ciphertext)
    } 
  } catch (e) {
    // not logged in
    return undefined
  }
}

function decryptOthersPrivateKey(mySharedPrivateKey, targetPubKey, ciphertext) {      
  try {
    let conversationKey = window.NostrTools.nip44.v2.utils.getConversationKey(mySharedPrivateKey, targetPubKey)
    return window.NostrTools.nip44.v2.decrypt(ciphertext, conversationKey)
  } catch (e) {
    // not logged in
    return undefined
  }
}

async function teamPermissions(event) {
  await teamPermissions(event, await decryptMySharedPrivateKey(event))
}

async function teamPermissions(event, mySharedPrivateKeyHex) {
  if (mySharedPrivateKeyHex) {
    let sharedPublicKeyHex = window.NostrTools.getPublicKey(hexToBytes(mySharedPrivateKeyHex))
    if (event.pubkey == sharedPublicKeyHex) {
      // the shared key I have is the author of the event. I can decrypt all members. 
      let team = event.tags.filter(([k, v]) => k === "p").map(it => {
        let privateKeyToThisPerson = decryptOthersPrivateKey(mySharedPrivateKeyHex, it[1], it[3])
        if (privateKeyToThisPerson == mySharedPrivateKeyHex) {
          return {
            pubkey: it[1],
            canEdit: true, 
            canView: true,
          }
        } else {
          return {
            pubkey: it[1],
            canEdit: false, 
            canView: true,
          }
        }
      })

      if (team.find(member => member.pubkey == event.pubkey)) {
        // if has owner
        return team
      } else {
        // adds the owner
        return [
          {
            pubkey: event.pubkey,
            canEdit: true, 
            canView: true,
          },
          ...team
        ]
      }
    } 
  }
   
  let team =  event.tags.filter(([k, v]) => k === "p").map(it => {
    if (it[1] == event.pubkey) {
      return {
        pubkey: it[1],
        canEdit: true, 
        canView: true,
      }
    } else {
      return {
        pubkey: it[1],
        canEdit: false, 
        canView: true,
      }
    }
  })

  if (team.find(member => member.pubkey == event.pubkey)) {
    // if has owner
    return team
  } else {
    // adds the owner
    return [
      {
        pubkey: event.pubkey,
        canEdit: true, 
        canView: true,
      },
      ...team
    ]
  }
}


async function decryptPrivateTags(thisVersionsPrivateKeyInHex, thisVersionsPublicKeyHex, ciphertext) {
  if (ciphertext === "") return undefined
  try {
    if (thisVersionsPrivateKeyInHex) {
      let conversationKey = window.NostrTools.nip44.v2.utils.getConversationKey(thisVersionsPrivateKeyInHex, thisVersionsPublicKeyHex)
      return JSON.parse(window.NostrTools.nip44.v2.decrypt(ciphertext, conversationKey))
    } else {
      return undefined
    }
  } catch (e) {
    // not logged in
    return undefined
  }
}

async function decryptViewKey(editKeyInHex, event) {
  try {
    if (editKeyInHex) {
      let keyList = event.tags.filter(([k, v]) => k === "p").map(it => {
        let conversationKey = window.NostrTools.nip44.v2.utils.getConversationKey(editKeyInHex, it[1])
        return window.NostrTools.nip44.v2.decrypt(it[3], conversationKey)
      }).filter(it => it !== editKeyInHex)

      if (keyList.length > 0) {
        return keyList[0]
      } else {
        return undefined
      }
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
  let publicTitleTag = event.tags.find(([k, v]) => k === "title")

  let loggedIn = undefined
  if (window.nostr) { 
    try {
      loggedIn = await window.nostr.getPublicKey()
    } catch (e) {

    }
  }

  let myPrivateKeyHex = undefined
  let myPublicKeyHex = undefined

  let editPrivateKeyHex = undefined
  let viewPrivateKeyHex = undefined

  let privateTags = undefined
  let editKeyIsLoggedIn = false

  if (loggedIn) {
    myPrivateKeyHex = await decryptMySharedPrivateKey(loggedIn, event)

    console.log("Private", myPrivateKeyHex)

    // was granted a private key
    // figure out if it is to encrypt or decrypt
    if (myPrivateKeyHex) {
      // if the public key of the secret is the same as the event.pubkey, 
      myPublicKeyHex = window.NostrTools.getPublicKey(hexToBytes(myPrivateKeyHex))
      if (event.pubkey == myPublicKeyHex) {
        // I have edit permissions.
        editPrivateKeyHex = myPrivateKeyHex
        // Let's check if there is a separate key for the viewing permissions. 

        try {
          viewPrivateKeyHex = await decryptViewKey(editPrivateKeyHex, event)
        } catch (e) {
          console.log("err 1", dTag)
        }

        if (viewPrivateKeyHex) {
          console.log("Has Separate View Key", dTag)
          viewPublicKeyHex = window.NostrTools.getPublicKey(hexToBytes(viewPrivateKeyHex))

          // uses my private key to decrypt 
          try {
            privateTags = await decryptPrivateTags(myPrivateKeyHex, viewPublicKeyHex, event.content)
          } catch (e) {
            console.log("err 2", dTag)
          }
        } else {
          try {
            privateTags = await decryptPrivateTags(myPrivateKeyHex, event.pubkey, event.content)
          } catch (e) {
            console.log("err 3", dTag)
          }
        }
      } else {
        // I don't have edit permissions. 
        // I can't decrypt the other keys. 
        // just mark kas view. 
        viewPrivateKeyHex = myPrivateKeyHex

        if (loggedIn == event.pubkey) {
          editKeyIsLoggedIn = true

          try {
            privateTags = JSON.parse(await window.nostr.nip44.decrypt(myPublicKeyHex, event.content))
          } catch (e) {
            console.log("err 4", dTag)
            privateTags = await decryptPrivateTags(myPrivateKeyHex, event.pubkey, event.content)
          }
        } else {
          try {
            privateTags = await decryptPrivateTags(myPrivateKeyHex, event.pubkey, event.content)
          } catch (e) {
            console.log("err 5", dTag)
          }
        }
      }
    } else if (loggedIn == event.pubkey) {
      // This event has been signed by the main key
      editKeyIsLoggedIn = true

      try {
        privateTags = JSON.parse(await window.nostr.nip44.decrypt(event.pubkey, event.content))
      } catch (e) {
        console.log("err 6", dTag)
      }
    }
  }

  let privateTitleTag = undefined
  if (privateTags) {
    console.log(privateTags)
    privateTitleTag = privateTags.find(([k, v]) => k === "title")
  }

  let title = dTag
  if (publicTitleTag) {
    title = publicTitleTag[1]
  }
  if (privateTitleTag) {
    title = privateTitleTag[1]
  }

  let team = await teamPermissions(event, myPrivateKeyHex)
  let teamMap = new Map()
  team.forEach(it => {
    let current = teamMap.get(it.pubkey)
    if (!current || it.canEdit)
      teamMap.set(it.pubkey, it)
  })

  return {
    event: event, 
    dTag: dTag,
    address: event.kind + ":" + event.pubkey + ":" + dTag,
    title: title,
    privateTags: privateTags, 
    editPrivateKeyHex: editPrivateKeyHex,
    viewPrivateKeyHex: viewPrivateKeyHex,
    editKeyIsLoggedIn: editKeyIsLoggedIn,
    team: teamMap,
    canEdit: editPrivateKeyHex != null || editKeyIsLoggedIn,
    isPublic: hasDataTags(event)
  }
}

async function convertDataArrayToEvent(expandedEvent, univerData) {
  // user is readonly
  if (!(expandedEvent.editKeyIsLoggedIn || expandedEvent.editPrivateKeyHex)) {
    console.log("Cant create an event: user is not logged in or it is readonly")
    return
  }

  let teamArray = Array.from(expandedEvent.team.values())

  let tags = []
  let content = ""
  let oldPrivateTags = expandedEvent.privateTags
  if (!oldPrivateTags)
    oldPrivateTags = []

  if (expandedEvent.isPublic) {
    console.log("Saving as public spreadsheet")
    // saves all data in public tags
    // no view permissions
    // saves edit permissions, if any
    tags = [...expandedEvent.event.tags.filter(it => it[0] != "p" && it[0] != "data" && it[0] != "title"), ...oldPrivateTags.filter(it => it[0] != "p" && it[0] != "data")]
    
    // load updated data
    for (tagData of univerData) {
      tags.push(["data", ...tagData])
    }

    if (expandedEvent.title) {
      tags.push(["title", expandedEvent.title])
    }

    for (member of teamArray) {
      if (member.canEdit) {
        let editPrivateKeyHex = expandedEvent.editPrivateKeyHex
        if (!editPrivateKeyHex) {
          editPrivateKeyHex = bytesToHex(window.NostrTools.generateSecretKey())
        }

        if (expandedEvent.editKeyIsLoggedIn) {
          tags.push(["p", member.pubkey, "", await window.nostr.nip44.encrypt(member.pubkey, editPrivateKeyHex)])
        } else {
          let conversationKey = window.NostrTools.nip44.v2.utils.getConversationKey(editPrivateKeyHex, member.pubkey)
          tags.push(["p", member.pubkey, "", window.NostrTools.nip44.v2.encrypt(editPrivateKeyHex, conversationKey) ])
        }
      }
    }
  } else {
    // not public
    tags = [...expandedEvent.event.tags.filter(it => it[0] != "data" && it[0] != "p" && it[0] != "title")]
    let privateTags = [...oldPrivateTags.filter(it => it[0] != "d" && it[0] != "p" && it[0] != "data" && it[0] != "title" )]

    if (expandedEvent.title) {
      privateTags.push(["title", expandedEvent.title])
    }

    // load updated data
    for (tagData of univerData) {
      privateTags.push(["data", ...tagData])
    }  

    if (expandedEvent.editKeyIsLoggedIn) {
      console.log("Saving as logged in user")
      // saves all data in private tags
      // adds view permissions
      // only the author can edit

      let viewPrivateKeyHex = expandedEvent.viewPrivateKeyHex
      if (!viewPrivateKeyHex) {
        viewPrivateKeyHex = bytesToHex(window.NostrTools.generateSecretKey())
      }
      let viewPublicKeyHex = window.NostrTools.getPublicKey(hexToBytes(viewPrivateKeyHex))

      for (member of teamArray) {
        if (member.canView) {
          tags.push(["p", member.pubkey, "", await window.nostr.nip44.encrypt(member.pubkey, viewPrivateKeyHex)])
        }
      }

      content = await window.nostr.nip44.encrypt(viewPublicKeyHex, JSON.stringify(privateTags))
    } else {
      console.log("Saving with edit keys", expandedEvent.editPrivateKeyHex, window.NostrTools.getPublicKey(hexToBytes(expandedEvent.editPrivateKeyHex)))
      // saves all data in private tags
      // adds view permissions
      // adds edit permissions

      let editPrivateKeyHex = expandedEvent.editPrivateKeyHex
      if (!editPrivateKeyHex) {
        editPrivateKeyHex = bytesToHex(window.NostrTools.generateSecretKey())
      }
      let editPublicKeyHex = window.NostrTools.getPublicKey(hexToBytes(editPrivateKeyHex))

      let viewPrivateKeyHex = expandedEvent.viewPrivateKeyHex
      if (!viewPrivateKeyHex) {
        viewPrivateKeyHex = bytesToHex(window.NostrTools.generateSecretKey())
      }
      let viewPublicKeyHex = window.NostrTools.getPublicKey(hexToBytes(viewPrivateKeyHex))

      let hasView = false

      for (member of teamArray) {
        if (member.canEdit) {
          let conversationKey = window.NostrTools.nip44.v2.utils.getConversationKey(editPrivateKeyHex, member.pubkey)
          tags.push(["p", member.pubkey, "", window.NostrTools.nip44.v2.encrypt(editPrivateKeyHex, conversationKey) ])
        } else if (member.canView) {
          let conversationKey = window.NostrTools.nip44.v2.utils.getConversationKey(editPrivateKeyHex, member.pubkey)
          tags.push(["p", member.pubkey, "", window.NostrTools.nip44.v2.encrypt(viewPrivateKeyHex, conversationKey) ])
          hasView = true
        }
      }

      if (hasView) {
        let contentConversationKey = window.NostrTools.nip44.v2.utils.getConversationKey(editPrivateKeyHex, viewPublicKeyHex)
        content = window.NostrTools.nip44.v2.encrypt(JSON.stringify(privateTags), contentConversationKey) 
      } else {
        let contentConversationKey = window.NostrTools.nip44.v2.utils.getConversationKey(editPrivateKeyHex, editPublicKeyHex)
        content = window.NostrTools.nip44.v2.encrypt(JSON.stringify(privateTags), contentConversationKey) 
      }
    }
  }

  let event = {
    kind: 35337, 
    created_at: Math.floor((new Date()).getTime() / 1000),
    content: content,
    tags: tags,
  };

  if (expandedEvent.editKeyIsLoggedIn) {
    return await nostrSign(event)
  } else if (expandedEvent.editPrivateKeyHex) {
    return window.NostrTools.finalizeEvent(event, hexToBytes(expandedEvent.editPrivateKeyHex))
  }
}

async function blankPrivateSheet(dTag) {
  let me = await window.nostr.getPublicKey()

  if (me) {
    let editPrivateKey = window.NostrTools.generateSecretKey()
    let editPublicKey = window.NostrTools.getPublicKey(editPrivateKey)
    let editPrivateKeyHex = bytesToHex(editPrivateKey)
  
    let contentConversationKey = window.NostrTools.nip44.v2.utils.getConversationKey(editPrivateKeyHex, editPublicKey)
    let content = window.NostrTools.nip44.v2.encrypt(JSON.stringify([]), contentConversationKey) 

    let pTagConversationKey = window.NostrTools.nip44.v2.utils.getConversationKey(editPrivateKeyHex, me)

    let tags = [
      ["d", dTag], 
      ["alt","A spreadsheet"],
      ["p", me, "", window.NostrTools.nip44.v2.encrypt(editPrivateKeyHex, pTagConversationKey)]
    ]
  
    let event = {
      kind: 35337, 
      created_at: Math.floor((new Date()).getTime() / 1000),
      content: content,
      tags: tags,
    };
  
    let evt = window.NostrTools.finalizeEvent(event, editPrivateKey)
    console.log("Blank Sheet", JSON.stringify(evt))
    return evt
  }
}

async function fetchAllSpreadsheets(relay, author, onReady, newUserMetadata) {
  tentatives = 0

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

  console.log("Fetch All using subs", subscriptions)

  await observe(
    relay, 
    subscriptions,
    (state) => {
      console.log("OnState", relay, state)
    },
    async (event) => { 
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

function hasDataTags(event) {
  return event.tags.find(tag => tag[0] == "data") != undefined
}

async function fetchSpreadSheet(relay, author, dTag, createNewSheet, newUserMetadata, ) {
  tentatives = 0

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
      console.log("OnState", relay, state)
    },
    async (event) => { 
      if (event.kind == 0) {
        newUserMetadata(event.pubkey, JSON.parse(event.content))
      } else if (event.kind == 35337) {
        if (!eventIds.has(event.id) && (!lastEvent || event.created_at > lastEvent.created_at)) {
          console.log("Loading", relay, event)
          eventIds.add(event.id)
          loadAllKeysFromSheet(event)

          let expandedEvent = await expandEvent(event)
          createNewSheet(expandedEvent, await convertEventToDataArray(event.tags, expandedEvent.privateTags))
        } else {
          console.log("Already has event", relay, event)
        }
      }
    }, 
    (eventId, inserted, message) => {
      console.log("Event Ack", relay, eventId, inserted, message)

      if (subscriptions["MYSUB1"].filter.authors.length != userMetatada.size) {
        subscriptions["MYSUB1"].filter = {
          "authors": Array.from(userMetatada.keys()),
          "kinds":[0]
        }
        updateSubscriptions(ws, subscriptions)
      } 
    },
    async (subscription) => {
      console.log("EOSE", relay)

      if (subscriptions["MYSUB1"].filter.authors.length != userMetatada.size) {
        subscriptions["MYSUB1"].filter = {
          "authors": Array.from(userMetatada.keys()),
          "kinds":[0]
        }
        updateSubscriptions(ws, subscriptions)
      }

      if (subscription.id == "MYSUB0" && eventIds.size == 0) {
        createNewSheet(await expandEvent(await blankPrivateSheet(dTag)), [])
      }
    }
  )
}

async function deleteSpreadSheet(expandedEvent) {
  let event = {
    kind: 5, 
    created_at: Math.floor(Date.now() / 1000),
    content: "",
    tags: [["e", expandedEvent.event.id], ["a",expandedEvent.address]],
  };

  let loggedInUser = await window.nostr.getPublicKey()

  console.log("Deleting", event)

  if (loggedInUser == expandedEvent.event.pubkey) {
    let evt = await nostrSign(event)
    let eventStr = JSON.stringify(['EVENT', evt])
    ws.send(eventStr)
    console.log("Deleting Event", ws, eventStr)
  } else if (expandedEvent.editPrivateKeyHex) {
    // if it has a valid shared key for this event. 
    let privateKeyBytes = hexToBytes(expandedEvent.editPrivateKeyHex)
    let eventSharedPubKey = window.NostrTools.getPublicKey(privateKeyBytes)

    if (expandedEvent.event.pubkey == eventSharedPubKey) {
      let evt = window.NostrTools.finalizeEvent(event, privateKeyBytes)  
      let eventStr = JSON.stringify(['EVENT', evt])
      ws.send(eventStr)
      console.log("Deleting Event using shared key", ws, eventStr)
    }
  }
}

async function saveSpreadSheet(expandedEvent, univerData) {
  let event = await convertDataArrayToEvent(expandedEvent, univerData)
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
      websocket.send(JSON.stringify(['REQ', sub.id, sub.filter]))
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
      onEOSE(subState)
    }

    if (msgType === 'NOTICE') {
      console.log("Notice", messageArray)
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

function generateUUID() { // Public Domain/MIT
  var d = new Date().getTime();//Timestamp
  var d2 = ((typeof performance !== 'undefined') && performance.now && (performance.now()*1000)) || 0;//Time in microseconds since page-load or 0 if unsupported
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16;//random number between 0 and 16
      if(d > 0){//Use timestamp until depleted
          r = (d + r)%16 | 0;
          d = Math.floor(d/16);
      } else {//Use microseconds since page-load if supported
          r = (d2 + r)%16 | 0;
          d2 = Math.floor(d2/16);
      }
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}