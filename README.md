## Trezor Signing Library for Blockstack

This package implements the `TransactionSigner` interface from blockstack.js
using Trezor's `connect.js` API.

This provides both single-sig and multi-sig signers.

To use:

```javascript
import { TrezorSigner } from 'blockstack-trezor'
import bsk from 'blockstack'

const signer = TrezorSigner.create(`m/44'/88'/0'/0/1`)
bsk.makeTokenTransfer(recipientAddress, 'STACKS', BigInteger.fromHex('10'), '', signer)
    .then((signedTX) => ...)
```

*Note:* Because this uses `connect.js`, this is only usable in browser-y contexts.


### Testnet Usage

Using this in normal Blockstack reg-test contexts is kind of difficult. This is because
Trezor's interfaces will not let you specify a particular Bitcoin bitcore node to use, rather,
they use their own Testnet nodes (I understand their reasons for this, as this is the best policy
for the security of users, but it makes testing much harder!) Instead, the way I've been testing
this is to point the `blockstack.js` configuration at the blockstack testnet, and override the
bitcoind URL to point at the Trezor bitcore instances. This "works" in that it will correctly
generate and sign transactions which are valid on the Bitcoin Testnet, however, because
this is actually a different network from Blockstack's testnet, these transaction will not
be picked up there.

Anyways, this terrible conconction can be configured via:

```javascript
import { configureTestnet } from 'blockstack-trezor'

configureTestnet()
// now your blockstack.js network configuration object will
//  be configured to use trezor's bitcore service.
```
