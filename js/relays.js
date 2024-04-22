const fixedRelays = [
  'wss://atlas.nostr.land', // paid relay	15000	npub12262qa4uhw7u8gdwlgmntqtv7aye8vdcmvszkqwgs0zchel6mz7s6cgrkj
  'wss://bitcoiner.social', // paid relay	1000	npub1dxs2pygtfxsah77yuncsmu3ttqr274qr5g5zva3c7t5s3jtgy2xszsn4st
  'wss://eden.nostr.land', // paid relay	5000	npub16k7j4mwsqm8hakjl8x5ycrqmhx89lxkfwz2xxxcw75eav7sd8ztqy2rwdn
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://a.nos.lol',
  'wss://nostr.bitcoiner.social',
  'wss://nostr.blocs.fr',
  'wss://nostr.decentony.com', // paid relay	7000	npub1pp9csm9564ewzer3f63284mrd9u2zssmreq42x4rtt390zmkrj2st4fzpm
  'wss://nostr.fmt.wiz.biz',
  'wss://nostr.inosta.cc', // paid relay	5000	npub1r34nhc6nqswancymk452f2frgn3ypvu77h4njr67n6ppyuls4ehs44gv0h
  'wss://nostr.plebchain.org', // paid relay	6969	npub1u2tehhr3ye4lv4dc8aen2gkxf6zljdpf356sgfjqfun0wxehvquqgvhuec
  'wss://nostr.wine', // paid relay	8888	npub18kzz4lkdtc5n729kvfunxuz287uvu9f64ywhjz43ra482t2y5sks0mx5sz
  'wss://filter.nostr.wine',
  'wss://inbox.nostr.wine',
  'wss://private.red.gb.net', // paid relay	8888	npub1nctdevxxuvth3sx6r0gutv4tmvhwy9syvpkr3gfd5atz67fl97kqyjkuxk
  'wss://puravida.nostr.land', // paid relay	10000	npub16k7j4mwsqm8hakjl8x5ycrqmhx89lxkfwz2xxxcw75eav7sd8ztqy2rwdn
  'wss://relay.current.fyi',
  'wss://relay.damus.io',
  'wss://relay.nostr.bg',
  'wss://relay.nostr.com.au', // paid relay	6969	npub1qqqqqrre3jxkuyj3s4m59usdyvm0umgm0lpy6cqjtwpt649sdews5q3hw7
  'wss://relay.nostr.info',
  'wss://relay.nostrati.com', // paid relay	2000	npub1qqqqqqqut3z3jeuxu70c85slaqq4f87unr3vymukmnhsdzjahntsfmctgs
  'wss://relay.nostriches.org', // paid relay 421	npub1vnmhd287pvxxk5w9mcycf23av24nscwk0da7rrfaa5wq4l8hsehs90ftlv
  'wss://relay.snort.social',
  'wss://nostr.oxtr.dev',
  'wss://nostr.mom',
  'wss://relay.nostr.band'
]

const buggyRelays = new Set([
  'wss://fonstr-test.onrender.com',
  'wss://fiatjaf.com',
  'wss://pyramid.fiatjaf.com'
])

var allAvailableRelays = []

fetch("https://api.nostr.watch/v1/online")
     .then(response => response.json())
     .then(json => allAvailableRelays = [... new Set(fixedRelays.concat(json))].filter((url) => !buggyRelays.has(url)  ) ); 
