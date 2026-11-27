import { setNavLayout, useNavLayout, type NavLayout } from '../navLayout';

const OPTIONS: { id: NavLayout; label: string }[] = [
  { id: 'top', label: 'Top bar' },
  { id: 'rail', label: 'Side rail' },
];

/** Settings → My account: where the menu sits on a computer screen (remembered by this browser). */
export default function AppearancePanel() {
  const layout = useNavLayout();
  return (
    <section className="panel">
      <h3>Appearance</h3>
      <div className="row between wrap">
        <div>
          <div className="strong">Menu</div>
          <p className="muted small" style={{ margin: 0 }}>
            A bar across the top, or a slim rail of icons on the left. Phones always use the ☰ menu. Saved in this browser.
          </p>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Menu position">
          {OPTIONS.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={layout === o.id} className={layout === o.id ? 'on' : ''} onClick={() => setNavLayout(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
