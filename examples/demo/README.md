# greenlight demo

A tiny project with a deliberate bug, used to try greenlight end to end.

`subtotal()` ignores `quantity`, so two tests fail:

```bash
npm install
npm test
```

Ask greenlight to fix it locally (needs `ANTHROPIC_API_KEY`):

```bash
npx greenlight-ci fix --run "npm test"
```

The expected fix is a one-line change in `src/cart.ts`:

```diff
-  return items.reduce((sum, item) => sum + item.price, 0);
+  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
```

greenlight is not allowed to edit `src/cart.test.ts`, so it cannot pass by changing the expected numbers.
