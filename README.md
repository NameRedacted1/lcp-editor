# LCP Editor

An editor for lancer content packs. Everything runs client-side.
My personal live instance can be found @ https://dice.continentcraft.net/lcp-editor

- Create, import, export, and edit lcps.
- Field-by-field forms for most things plus a raw JSON view.
- Convert a pack between the v2 and v3 lcp formats (wip, some assumptions are made).
- Eidolon assembler for building the Eidolon and Shard classes from layer data (wip, can import into v2 or v3 packs).

## Running your own

Node >= 22.

```
npm install
npm run build
npm run test
npm run typecheck
```

`dist` is the site root - serve it directly with any static file server.