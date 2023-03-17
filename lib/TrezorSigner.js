'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TrezorSigner = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _bitcoinjsLib = require('bitcoinjs-lib');

var _bitcoinjsLib2 = _interopRequireDefault(_bitcoinjsLib);

var _trezorConnect = require('trezor-connect');

var _trezorConnect2 = _interopRequireDefault(_trezorConnect);

var _blockstack = require('blockstack');

var _utils = require('./utils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

_trezorConnect2.default.manifest({
  email: 'admin@blockstack.com',
  appUrl: 'https://blockstack.org'
});

var TrezorSigner = exports.TrezorSigner = function () {
  function TrezorSigner(hdpath, address) {
    _classCallCheck(this, TrezorSigner);

    this.address = address;
    this.hdpath = hdpath;
  }

  _createClass(TrezorSigner, [{
    key: 'getAddress',
    value: function getAddress() {
      return Promise.resolve(this.address);
    }
  }, {
    key: 'prepareInputs',
    value: function prepareInputs(inputs, myIndex) {
      var _this = this;

      return inputs.map(function (input, inputIndex) {
        var translated = TrezorSigner.translateInput(input);
        if (inputIndex === myIndex) {
          translated['address_n'] = (0, _utils.pathToPathArray)(_this.hdpath);
        }
        return translated;
      });
    }
  }, {
    key: 'prepareOutputs',
    value: function prepareOutputs(outputs) {
      return outputs.map(function (output) {
        if (_bitcoinjsLib2.default.script.toASM(output.script).startsWith('OP_RETURN')) {
          var nullData = _bitcoinjsLib2.default.script.decompile(output.script)[1];
          return {
            op_return_data: nullData.toString('hex'),
            amount: '0',
            script_type: 'PAYTOOPRETURN'
          };
        } else {
          var address = _blockstack.config.network.coerceAddress(_bitcoinjsLib2.default.address.fromOutputScript(output.script));
          return {
            address: address,
            amount: '' + output.value,
            script_type: 'PAYTOADDRESS'
          };
        }
      });
    }
  }, {
    key: 'signTransaction',
    value: function signTransaction(txB, signInputIndex) {
      return this.signTransactionSkeleton(txB.__tx, signInputIndex).then(function (resp) {
        var signedTxHex = resp.tx;
        // god of abstraction, forgive me, for I have transgressed
        var signedTx = _bitcoinjsLib2.default.Transaction.fromHex(signedTxHex);
        var signedTxB = _bitcoinjsLib2.default.TransactionBuilder.fromTransaction(signedTx);
        txB.__inputs[signInputIndex] = signedTxB.__inputs[signInputIndex];
      });
    }
  }, {
    key: 'prepareTransactionInfo',
    value: function prepareTransactionInfo(tx, signInputIndex, extra) {
      var _this2 = this;

      return Promise.resolve().then(function () {
        // we need to do a _lot_ of garbage here.
        // prepare inputs / outputs for trezor format
        var inputs = _this2.prepareInputs(tx.ins, signInputIndex, extra);
        var outputs = _this2.prepareOutputs(tx.outs);

        return { inputs: inputs, outputs: outputs };
      });
    }
  }, {
    key: 'signTransactionSkeleton',
    value: function signTransactionSkeleton(tx, signInputIndex, extra) {
      return this.prepareTransactionInfo(tx, signInputIndex, extra).then(function (txInfo) {
        var coin = (0, _utils.getCoinName)();
        return _trezorConnect2.default.signTransaction({
          inputs: txInfo.inputs,
          outputs: txInfo.outputs,
          coin: coin
        }).then(function (resp) {
          if (!resp.success) {
            if (resp.payload && resp.payload.error) {
              throw new Error('Failed to sign Trezor transaction: ' + resp.payload.error);
            } else {
              throw new Error('Failed to sign Trezor transaction.');
            }
          }
          return {
            tx: resp.payload.serializedTx,
            signatures: resp.payload.signatures
          };
        });
      });
    }
  }, {
    key: 'signerVersion',
    value: function signerVersion() {
      return 1;
    }
  }], [{
    key: 'createSigner',
    value: function createSigner(hdpath) {
      return TrezorSigner.getAddressFrom(hdpath).then(function (address) {
        return new TrezorSigner(hdpath, address);
      });
    }
  }, {
    key: 'translateInput',
    value: function translateInput(input) {
      var scriptSig = input.script.length > 0 ? input.script.toString('hex') : null;
      return {
        prev_index: input.index,
        prev_hash: Buffer.from(input.hash).reverse().toString('hex'),
        sequence: input.sequence,
        script_sig: scriptSig
      };
    }
  }, {
    key: 'getPublicKeys',
    value: function getPublicKeys(paths) {
      return _trezorConnect2.default.getPublicKey({
        bundle: paths.map(function (path) {
          return { path: path };
        })
      }).then(function (response) {
        if (!response.success) {
          if (response.payload && response.payload.error) {
            throw new Error('Failed to load addresses from Trezor: ' + response.payload.error);
          } else {
            throw new Error('Failed to load addresses from Trezor');
          }
        }
        var values = response.payload;
        return paths.map(function (path) {
          var xpub = values.find(function (value) {
            return 'm/' + value.serializedPath === path;
          }).xpub;
          var pk = _bitcoinjsLib2.default.bip32.fromBase58(xpub).publicKey;
          return pk.toString('hex');
        });
      });
    }
  }, {
    key: 'getAddressFrom',
    value: function getAddressFrom(hdpath) {
      return TrezorSigner.getPublicKeys([hdpath]).then(function (pks) {
        var address = _bitcoinjsLib2.default.payments.p2pkh({
          pubkey: Buffer.from(pks[0], 'hex')
        }).address;
        return _blockstack.config.network.coerceAddress(address);
      });
    }
  }]);

  return TrezorSigner;
}();