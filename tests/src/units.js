const bsk = require('blockstack')
import FetchMock from 'fetch-mock'
import btc from 'bitcoinjs-lib'
import { NullSigner, TrezorSigner,
         TrezorMultiSigSigner, getMultiSigInfo } from '../../lib'

jasmine.DEFAULT_TIMEOUT_INTERVAL = 5000000
const FUNDER_KEY_0 = 'cf0a48131c07cbef652f929af118bb9adbf58e76843f268ac5feeaac7e45b79401'
const FUNDER_KEY_1 = '9450a332e3f15a877dc14b2ee30bf37db308bb31c65cfe417723deea8a59b96e01'
const MULTISIG_PARTICIPANT = 'aece5b5120db05223fb304fc5f7e281a492f59699a0947d7717c6020419a0bf401'

const EXPECTED_SINGLE_SIG = '01000000020e8846ce9ed64f4ee4c40923a9b4c36c152123cc1a159788170362479cb' +
      '3cbae000000006a4730440220597dc66cc0ec4c6f0f6ef89f714cc241c5b4812929fc1fbb7d98df75e770a94a02' +
      '207284e331e499b7e39402df0eaa942db67719db3dfd5fc0164a5a2e989aa057100121020e06bf1e83e3c09ab11' +
      '3669d0d910cd9de625fd4d597b21e4fe2c0bf11547d56ffffffffb7cec626bcfea88b82471fe3a135f8281d316c' +
      '27b81758ad04318a15faabe062000000006b48304502210088ce98e719f3f19e07e49ef39df10a22b30e7d8b28e' +
      '958bd53480ec996458d560220672b60d5eb365d2cc10154608b7854e28a36bee626dd5d5eec64720d0b2929cb01' +
      '2103a4a12bf55a419a4c9b294af2d495aa9b5c22d26919d59e449babe43e5b2dc7eaffffffff030000000000000' +
      '000296a2769642bb93183b4fb5179a8cf9e7fdead6ff8a0b4d97fa2ddc1ad90141606d036741722bb61dca850c3' +
      '0000000000001976a9143eb34fe8fd98a1abe460280faf59e62f94e4c1d288ac60790400000000001976a914672' +
      '10e6662257f44a36d323d51a5be8045c02b1c88ac00000000'

const EXPECTED_MULTI_SIG = '01000000022d84d97a3ea140fb4f0d0357ae474e8f50be8d0aff2b28bab75f79ee2f23' +
      '83d600000000fd1f010048304502210087883ec7fc06cf345e5863c197c8898da31e0f1706e8996c4877ebc3f34' +
      'f494702205c0274ce64b3bf0e965e1527adc7ed8fd4040a5f1c52bf2e209fcf20facfc63201473044022025ab4d' +
      '9ff1df1d6c8dda8fe45101e68f3137027164e2ee7b30a49006df608f9402206b3dfc247cf9d1d687689d05e43aa' +
      '42667b8083fd86bb532215303bc123c2c4c014c8b52210233a05fc0e2aca2f0ee43ddfc455666ca944fe5fd556a' +
      'd60113927019877292c421038eeab3ac28b5393d5bbf10fe6a8055da08b1d74ad6891430729c690f24e3035b210' +
      '2f06d8491e26808eb5ae37f7852d46b5e10d24fa0113b2052d8bd062df1cdf44d21032f1fa70655e2cef519f1d4' +
      '849d54a96bfd62ff78d86b6473313ee24755f3dd0254aeffffffff2d84d97a3ea140fb4f0d0357ae474e8f50be8' +
      'd0aff2b28bab75f79ee2f2383d6010000006a47304402203ba1881330cfe732666c46a470b9081de721c49f7603' +
      'c54f08b8bd84510044e202207ae0e73ce221c26247d0fe73856d66986d13bbabd17661d78b88dd7aa863c5a5012' +
      '1026589496651301fba395ce0d35103de85c8fed58c40a3a93d40da7e455d28d16bffffffff0300000000000000' +
      '00296a2769642bb93183b4fb5179a8cf9e7fdead6ff8a0b4d97fa2ddc1ad90141606d036741722bb61dca8a8610' +
      '0000000000017a914963b2cb4c61afe596fa435031d5b1dbaf4b54da887d8940400000000001976a9141b4bddc9' +
      '98cbe79299de5cfd68a77811217ebb5888ac00000000'

function setupMocks() {
  FetchMock.restore()

  const mocks = [
    { k: 'https://bitcoinfees.earn.com/api/v1/fees/recommended',
      v: { fastestFee: 16, halfHourFee: 16, hourFee: 6 } },
    { k: 'https://core.blockstack.org/v1/blockchains/bitcoin/consensus',
      v: {'consensus_hash': '137e98bb8a58e845e156db6b75c3be6a'} },
    { k: 'https://blockchain.info/unspent?format=json&active=1AQJCYjDKHaxFqTa4Q3eQB6RovwJ53Bmbt&cors=true',
      v: { unspent_outputs:
           [ { tx_hash: 'b7cec626bcfea88b82471fe3a135f8281d316c27b81758ad04318a15faabe062',
               tx_hash_big_endian: '62e0abfa158a3104ad5817b8276c311d28f835a1e31f47828ba8febc26c6ceb7',
               tx_index: 379956008,
               tx_output_n: 0,
               script: '76a91467210e6662257f44a36d323d51a5be8045c02b1c88ac',
               value: 300000,
               value_hex: '0493e0',
               confirmations: 2 } ] } },
    { k: 'https://blockchain.info/unspent?format=json&active=16iXhim7Z7eXBcFVzGCu2XNQXAwu39h6sX&cors=true',
      v: { unspent_outputs:
           [ { tx_hash: '0e8846ce9ed64f4ee4c40923a9b4c36c152123cc1a159788170362479cb3cbae',
               tx_hash_big_endian: 'aecbb39c476203178897151acc2321156cc3b4a92309c4e44e4fd69ece46880e',
               tx_index: 379955895,
               tx_output_n: 0,
               script: '76a9143eb34fe8fd98a1abe460280faf59e62f94e4c1d288ac',
               value: 50000,
               value_hex: '00c350',
               confirmations: 2 } ] } },
    { k: 'https://blockchain.info/unspent?format=json&active=13VL8U3nDpwLafHzLBx5nkj9HVwp15cVoF&cors=true',
      v: { unspent_outputs:
           [ { tx_hash: '2d84d97a3ea140fb4f0d0357ae474e8f50be8d0aff2b28bab75f79ee2f2383d6',
               tx_hash_big_endian: 'd683232fee795fb7ba282bff0a8dbe508f4e47ae57030d4ffb40a13e7ad9842d',
               tx_index: 379984046,
               tx_output_n: 1,
               script: '76a9141b4bddc998cbe79299de5cfd68a77811217ebb5888ac',
               value: 307000,
               value_hex: '04af38',
               confirmations: 0
             } ] } },
    { k: 'https://blockchain.info/unspent?format=json&active=3FPNAquDUEK4DjJ5KnPqJQEV1dDkKQUePz&cors=true',
      v: { unspent_outputs:
           [ { tx_hash: '2d84d97a3ea140fb4f0d0357ae474e8f50be8d0aff2b28bab75f79ee2f2383d6',
               tx_hash_big_endian: 'd683232fee795fb7ba282bff0a8dbe508f4e47ae57030d4ffb40a13e7ad9842d',
               tx_index: 379984046,
               tx_output_n: 0,
               script: 'a914963b2cb4c61afe596fa435031d5b1dbaf4b54da887',
               value: 25000,
               value_hex: '61a8',
               confirmations: 0 } ] }},
  ]

  mocks.forEach(mock => FetchMock.get(mock.k, mock.v))
}

describe('single-sig-test', function () {
  it('generates correctly signed update tx', function (done) {
    setupMocks()

    const payerAddress = bsk.publicKeyToAddress(
      bsk.getPublicKeyFromPrivate(FUNDER_KEY_0.slice(0, -2)))

    return TrezorSigner.createSigner(`m/44'/5757'/0'/0/0`)
      .then(signer => {
        return signer.getAddress()
          .then(ownerAddress => {
            console.log(JSON.stringify({ownerAddress,
                                        payerAddress}))
          })
          .then(() => bsk.transactions.makeUpdate('trezorio.id',
                                                  signer,
                                                  FUNDER_KEY_0,
                                                  'trezor says hello'))
          .then((rawTX) => {
            console.log(rawTX)
            expect(rawTX).toBe(EXPECTED_SINGLE_SIG)
          })
      })
      .then(() => done())
      .catch((err) => {
        expect(false).toBe(true)
        console.log(err)
        done()
      })
  })
})

describe('multi-sig-test-1', function () {
  it('generates correctly signed update tx', function (done) {
    FetchMock.restore()
    setupMocks()

    const payerAddress = bsk.publicKeyToAddress(
      bsk.getPublicKeyFromPrivate(FUNDER_KEY_1.slice(0, -2)))

    const ownerPubKeyPaths = [1, 2, 3].map(i => `m/44'/5757'/0'/0/${i}`)

    return TrezorSigner.getPublicKeys(ownerPubKeyPaths)
      .then((pubkeys) => {
        const ownerPubKeys = pubkeys.map(pkHex => pkHex)
        const extraPubKeyHex = bsk.getPublicKeyFromPrivate(MULTISIG_PARTICIPANT.slice(0, -2))
        ownerPubKeys.push(extraPubKeyHex)
        return getMultiSigInfo(ownerPubKeys, 2)
      })
      .then((ownerMultiSigInfo) => {
        console.log(JSON.stringify({ ownerAddress: ownerMultiSigInfo.address,
                                     payerAddress }, undefined, 2))
        const signer = new NullSigner(ownerMultiSigInfo.address)
        return bsk.transactions.makeUpdate('trezorio.id',
                                           signer,
                                           FUNDER_KEY_1,
                                           'trezor says hello',
                                           undefined,
                                           true)
          .then((onceSignedTX) => {
            console.log('->')
            console.log(onceSignedTX)
            const asTXB = btc.TransactionBuilder.fromTransaction(
              btc.Transaction.fromHex(onceSignedTX), bsk.config.network.layer1)
            const ecPair = bsk.hexStringToECPair( MULTISIG_PARTICIPANT )
            asTXB.sign(0, ecPair, Buffer.from(ownerMultiSigInfo.redeemScript, 'hex'))
            return asTXB.build().toHex()
          })
          .then((unsignedTX) => {
            console.log('->')
            console.log(unsignedTX)

            const asTXB = btc.TransactionBuilder.fromTransaction(
              btc.Transaction.fromHex(unsignedTX))

            return TrezorMultiSigSigner.createSigner(`m/44'/5757'/0'/0/3`,
                                                     ownerMultiSigInfo.redeemScript)
              .then(txSigner => txSigner.signTransaction(asTXB, 0))
              .then(() => asTXB.build().toHex())
          })
          .then((finishedTX) => {
            expect(finishedTX).toBe(EXPECTED_MULTI_SIG)
            console.log('Completed:')
            console.log(finishedTX)
          })

      })
      .then(() => done())
      .catch((err) => {
        expect(false).toBe(true)
        console.log(err)
        done()
      })
  })
})

describe('multi-sig-test-2', function () {
  it('generates correctly signed update tx', function (done) {
    FetchMock.restore()
    setupMocks()

    const payerAddress = bsk.publicKeyToAddress(
      bsk.getPublicKeyFromPrivate(FUNDER_KEY_1.slice(0, -2)))

    const ownerPubKeyPaths = [1, 2, 3].map(i => `m/44'/5757'/0'/0/${i}`)

    return TrezorSigner.getPublicKeys(ownerPubKeyPaths)
      .then((pubkeys) => {
        const ownerPubKeys = pubkeys.map(pkHex => pkHex)
        const extraPubKeyHex = bsk.getPublicKeyFromPrivate(MULTISIG_PARTICIPANT.slice(0, -2))
        ownerPubKeys.push(extraPubKeyHex)
        return getMultiSigInfo(ownerPubKeys, 2)
      })
      .then((ownerMultiSigInfo) => {
        console.log(JSON.stringify({ ownerAddress: ownerMultiSigInfo.address,
                                     payerAddress }, undefined, 2))
        const signer = new NullSigner(ownerMultiSigInfo.address)
        return bsk.transactions.makeUpdate('trezorio.id',
                                           signer,
                                           FUNDER_KEY_1,
                                           'trezor says hello',
                                           undefined,
                                           true)
          .then((unsignedTX) => {
            console.log('->')
            console.log(unsignedTX)

            const asTXB = btc.TransactionBuilder.fromTransaction(
              btc.Transaction.fromHex(unsignedTX))

            return TrezorMultiSigSigner.createSigner(`m/44'/5757'/0'/0/3`,
                                                     ownerMultiSigInfo.redeemScript)
              .then(txSigner => txSigner.signTransaction(asTXB, 0))
              .then(() => asTXB.build().toHex())
          })
          .then((onceSignedTX) => {
            console.log('->')
            console.log(onceSignedTX)
            const asTXB = btc.TransactionBuilder.fromTransaction(
              btc.Transaction.fromHex(onceSignedTX), bsk.config.network.layer1)
            const ecPair = bsk.hexStringToECPair( MULTISIG_PARTICIPANT )
            asTXB.sign(0, ecPair, Buffer.from(ownerMultiSigInfo.redeemScript, 'hex'))
            return asTXB.build().toHex()
          })
          .then((finishedTX) => {
            expect(finishedTX).toBe(EXPECTED_MULTI_SIG)
            console.log('Completed:')
            console.log(finishedTX)
          })

      })
      .then(() => done())
      .catch((err) => {
        expect(false).toBe(true)
        console.log(err)
        done()
      })
  })
})

