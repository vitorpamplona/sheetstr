async function generateNostrEventId(msg) {
    const digest = [
        0,
        msg.pubkey,
        msg.created_at,
        msg.kind,
        msg.tags,
        msg.content,
    ];
    const digest_str = JSON.stringify(digest);
    const hash = await sha256Hex(digest_str);
  
    return hash;
  }
  
  function sha256Hex(string) {
    const utf8 = new TextEncoder().encode(string);
  
    return crypto.subtle.digest('SHA-256', utf8).then((hashBuffer) => {
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray
          .map((bytes) => bytes.toString(16).padStart(2, '0'))
          .join('');
  
        return hashHex;
    });
  }
  
  async function nostrSign(event) {
    // set event fields
    event.created_at = Math.floor((new Date()).getTime() / 1000);
    event.pubkey = await window.nostr.getPublicKey();

    // Generate event id
    event.id = await generateNostrEventId(event);

    // Sign event
    return await window.nostr.signEvent(event);
  }