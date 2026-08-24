# Generated API types

`schema.d.ts` is produced by `tools/openapi/gen.sh` from the backend's springdoc output at
`/v3/api-docs`, and is **committed** — see FRONTEND.md §4.2.

Do not edit it by hand. To refresh:

```bash
cd gatecrash-backend && mvn spring-boot:run -Dspring-boot.run.profiles=local   # in one terminal
pnpm gen:api                                                                   # in another
```

These types are **compile-time only**. For the four payloads where a wrong shape would be
silently destructive — `LoginResponse`, `MeResponse`, `VisitResponse`, `RedeemPassResponse` —
there are hand-written Zod schemas in `../schemas/` that parse at the boundary. Everywhere else
the generated type is trusted; parsing everything is a tax with no payer.

The file is absent until the script has been run against a live backend, which is why nothing
imports from it yet. When a CI job runs `gen.sh` against `main` and the diff is non-empty, a
backend contract has changed and the Zod schemas need checking in the same PR.
