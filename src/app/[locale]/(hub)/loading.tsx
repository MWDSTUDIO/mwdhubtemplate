/**
 * The instant the door opens: the room's silhouette appears at once —
 * quiet parchment blocks in the house's proportions — while the real
 * furniture is carried in. Navigation answers immediately instead of
 * holding the previous page frozen.
 */
export default function HubLoading() {
  return (
    <div className="page-loading" aria-hidden="true">
      <div className="ske ske-eyebrow" />
      <div className="ske ske-title" />
      <div className="ske-row">
        <div className="ske ske-card" />
        <div className="ske ske-card" />
        <div className="ske ske-card" />
      </div>
      <div className="ske ske-block" />
      <div className="ske ske-block short" />
    </div>
  );
}
