interface StudioHeaderProps { title: string; subtitle?: string; }
export default function StudioHeader({ title, subtitle }: StudioHeaderProps) {
  return <header className="aw-page-heading"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div></header>;
}
