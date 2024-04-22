// send events to a relay, returns a promisse
function openRelay(relay, filters, eventsToSend, onState, onNewEvent, onOk, onFilterChange, onError) {
  return new Promise((resolve, reject) => {
    try {
      const ws = new WebSocket(relay)
      
      // prevent hanging forever
      let myTimeout = setTimeout(() => { ws.close(); onState("Timeout"); reject(relay) }, 10_000)

      const timeoutCancel = () => {
        onState("Timeout"); 
        clearTimeout(myTimeout)
        ws.close(); 
        reject(relay)
      }

      const resetTimeOut = () => {
        // resets the timeout
        if (myTimeout != undefined) {
          clearTimeout(myTimeout)
          myTimeout = undefined
        }
        myTimeout = setTimeout(timeoutCancel, 10_000)
      }
      
      let isAuthenticating = false
      let okCounter = 0

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
        resetTimeOut()

        if (Object.keys(subscriptions).length > 0) {
          onState("Downloading")
          for (const [key, sub] of Object.entries(subscriptions)) {
            ws.send(JSON.stringify(['REQ', sub.id, sub.filter]))
          }
        }

        if (eventsToSend && eventsToSend.length > 0) {
          onState("Sending")
          for (evnt of eventsToSend) {
            ws.send(JSON.stringify(['EVENT', evnt]))
          }
          onState("Sent")
        }
      }

      // Listen for messages
      ws.onmessage = (str) => {
        const messageArray = JSON.parse(str.data)
        const [msgType] = messageArray

        if (msgType === 'AUTH') {
          resetTimeOut()

          isAuthenticating = true
          signNostrAuthEvent(relay, messageArray[1]).then(
            (event) => {
              if (event) {
                ws.send(JSON.stringify(['AUTH', event]))
              } else {
                onState("Auth Fail")
                clearTimeout(myTimeout)
                ws.close(); 
                reject(relay)
              }
            },
            (reason) => {
              onState("Auth Fail")
              clearTimeout(myTimeout)
              ws.close(); 
              reject(relay)
            },
          ) 
        }

        if (msgType === 'OK') {
          resetTimeOut()
          
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
              clearTimeout(myTimeout)
              ws.close(); 
              reject(relay)
            }
          } else {
            onOk(messageArray[1], messageArray[2], messageArray[3])
            okCounter++
            if (eventsToSend && eventsToSend.length == okCounter) {
              onState("Done")
              ws.close(); 
              clearTimeout(myTimeout)
              resolve(relay)
            }
          }
        } 

        // event messages
        if (msgType === 'EVENT') {
          resetTimeOut()

          const subState = subscriptions[messageArray[1]]
          const event = messageArray[2]

          try { 
            if (!matchFilter(subState.filter, event)) {
              console.log("Didn't match filter", relay, event, subState.filter)
            } else if (subState.eventIds.has(event.id)) {
              console.log("Duplicated", relay, event, subState.filter)
            } else if (subState.filter.limit && subState.counter >= subState.filter.limit) {
              subState.done = true
              onState("Done")

              ws.close(); 
              clearTimeout(myTimeout)
              resolve(relay)
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

          // if trully finished
          if (subState.eoseSessionCounter == 0 || 
            subState.lastEvent.created_at == 0 || // bug that until becomes undefined
            (subState.filter.limit && subState.counter >= subState.filter.limit) ||
            (subState.filter.until && subState.filter.until == subState.lastEvent.created_at - 1)
          ) { 
            subState.done = true
            
            let alldone = Object.values(subscriptions).every(filter => filter.done === true);
            if (alldone) {
              onState("Done")
              ws.close(); 
              clearTimeout(myTimeout)
              resolve(relay)
            }
          } else {
            // Restarting the filter is necessary to go around Max Limits for each relay. 

            subState.eoseSessionCounter = 0
            subState.filter.until = subState.lastEvent.created_at - 1

            ws.send(JSON.stringify(['REQ', subState.id, subState.filter]))

            onFilterChange(subState.filter)
          }
        }

        if (msgType === 'CLOSED') {
          const subState = subscriptions[messageArray[1]]

          subState.done = true
        
          let alldone = Object.values(subscriptions).every(filter => filter.done === true);
          if (alldone) {
            onState("Closed")
            ws.close(); 
            clearTimeout(myTimeout)
            resolve(relay)
          }
        }
      }
      ws.onerror = (err, event) => {
        onState("Error")
        //console.log("WS Error", relay, err, event)
        clearTimeout(myTimeout)
        ws.close(); 
        reject(relay)
      }
      ws.onclose = (event) => {
        onState("Done")
        //console.log("WS Close", relay, event)
        clearTimeout(myTimeout)
        resolve(relay)
      }
    } catch (exception) {
      onError(exception)
      console.log("Major", relay, exception)
      onState("Error")
      clearTimeout(myTimeout)
      ws.close(); 
      reject(relay)
    }
  })
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