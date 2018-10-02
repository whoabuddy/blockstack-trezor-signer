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
