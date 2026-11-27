# Vendored QR encoder

`qrcodegen.ts` is Project Nayuki's MIT-licensed QR encoder, from
https://github.com/nayuki/QR-Code-generator/blob/master/typescript-javascript/qrcodegen.ts
GitHub blob SHA: e2ef90b2eede8b3ce36fc03dc21d9e4f66b06fdd.
The full copyright/license header is retained; the only integration change is an ESM export.

The separate test decoder in tests/vendor/jsQR.cjs comes from
https://github.com/cozmo/jsQR/blob/master/dist/jsQR.js
GitHub blob SHA: 99ea9df26907009e5553233ffe03c529c1521739.
Its MIT license is retained in tests/vendor/jsQR-LICENSE.txt.
It is used only by tests and is not shipped in the application.
