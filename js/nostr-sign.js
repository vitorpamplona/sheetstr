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

function bytesToHex(bytes) {
  return buffer.Buffer.from(bytes).toString('hex')
}

function hexToBytes(hex) {
  if (typeof hex !== 'string') {
    throw new TypeError('hexToBytes: expected string, got ' + typeof hex)
  }
  if (hex.length % 2)
    throw new Error('hexToBytes: received invalid unpadded hex' + hex.length)
  const array = new Uint8Array(hex.length / 2)
  for (let i = 0; i < array.length; i++) {
    const j = i * 2
    const hexByte = hex.slice(j, j + 2)
    const byte = Number.parseInt(hexByte, 16)
    if (Number.isNaN(byte) || byte < 0) throw new Error('Invalid byte sequence')
    array[i] = byte
  }
  return array
}

// decode nip19 ('npub') to hex
const npub2hex = (npub) => {
  let { prefix, words } = bech32.bech32.decode(npub, 90)
  if (prefix === 'npub') {
    let data = new Uint8Array(bech32.bech32.fromWords(words))
    return bytesToHex(data)
  }
}

// encode hex to nip19 ('npub')
const hex2npub = (hex) => {
  const data = hexToBytes(hex)
  const words = bech32.bech32.toWords(data)
  const prefix = 'npub'
  return bech32.bech32.encode(prefix, words, 90)
}