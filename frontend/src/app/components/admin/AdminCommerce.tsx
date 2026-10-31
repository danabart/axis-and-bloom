import EvidenceParametersCard from './EvidenceParametersCard';

// Commerce 1, C5 (2026-10-31) — /admin/commerce: every business number of
// checkout (commerce_parameter) in one editable card — shipping fee and the
// free-shipping bag count, the tax switch and Stripe tax codes, the alert
// email, the collection discount and minimum, and the subscription numbers
// reserved for Commerce brief 2. A change takes effect on the next checkout
// (the backend's read cache is 60 s), no deploy.
export default function AdminCommerce() {
  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-xl font-medium text-stone-800 mb-6">Commerce</h1>
      <EvidenceParametersCard
        title="Commerce parameters"
        endpoint="/api/admin/commerce/parameters"
        intro="Shipping, tax, alerts, collection and subscription numbers. A save writes a new row that supersedes the current one; nothing is overwritten."
        footer="A change applies to the next checkout session (within a minute). Sessions already open keep the price they were created with."
        testId="commerce-parameters"
      />
    </div>
  );
}
