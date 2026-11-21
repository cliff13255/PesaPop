# Bubble setup

To be filled in during Phase 1 by Dev 3 (API Connector) and Dev 4 (design system).

Notes to start from:

- Every API Connector call uses a shared `base_url` parameter. Point it at the mock URL first,
  then switch to the real backend in Phase 5, in one place only.
- Protected calls send the header `Authorization: Bearer <token>`. Mark the token parameter
  private and never show or log it on a page.
- To initialize calls, use the mock's static tokens: `demo-customer-token` for customer calls,
  `demo-merchant-token` for `merchant_summary`, `create_payment_request` and `list_payment_requests`.
- Initialize `assistant_message` with a message that drafts a payment, e.g.
  `pay 1k to Mary 0722000333`, so Bubble learns the `payment_summary` fields (they are `null`
  when the assistant is still asking questions).
- Initialize `get_payment` with an id returned by `confirm_payment`, and wait 10 seconds so the
  response includes the `receipt` object.
