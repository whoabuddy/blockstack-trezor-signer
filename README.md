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

## Dependencies

Multi-sig support depends on the current `develop` branch of `blockstack.js`.

## Testing

This repo includes a karma-based testing system, which tests the generation/signing of
Blockstack `UPDATE` transactions.

To run these, you need to:

1. Install the Trezor emulator from [here](https://github.com/trezor/trezor-core/blob/master/docs/emulator.md)
2. Start the emulator and `trezord` with an emulator connection

```bash
# if you already have trezord running
$ sudo service trezord stop
# start emulator
$ ./emu.sh
# restart trezord with emulator connection
$ trezord -e 21324
```

3. Restore the emulator wallet with the following 12-word phrase:

```
wink around rely cluster level off monitor ugly oak enrich plate street
```

4. Run the karma tests:

```bash
$ npm run karma
```

5. You will be prompted throughout the tests to click through
   trezor-connect dialogs and confirm actions on the emulator. Do that.

See bitcoin transactions:

```
099b1dfc916ec5b435a8b8e50462984f359248fe30b9f276b8937e0a1eba37e2

6d9dad793ed967e6cd1821b86bc7aafad75b8b30b282f7b5255a7a71fb862150
```

For the bitcoin transactions which should be created.

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

*Just use mainnet BTC*: Since using BTC testnet is often a pain, it
can be easier to just use BTC mainnet, but point your _Blockstack_ API
at testnet. This will create real BTC spends, but they'll be invalid
Blockstack transactions. BE SURE NOT TO USE ADDRESSES WITH REAL STACKS BALANCES ---
OR NAMES as consensus hashes will invalidate some, but not all transactions.

To do that, just modify your `blockstack.js` configuration object:

```
  bsk.config.network = bsk.network.defaults.MAINNET_DEFAULT
  bsk.config.network.blockstackAPIUrl    = `http://${blockstackTestnet}:16268`
```

