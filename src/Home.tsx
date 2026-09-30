import { Link } from "./Link.tsx";
import { ROOTS } from "./roots.ts";

export function Home() {
  return (
    <>
      <h2>Home</h2>
      <section aria-labelledby="roots">
        <h3 id="roots">Browse</h3>
        <ul className="entries">
          {Object.values(ROOTS).map((root) => (
            <li key={root.href}>
              <Link to={root.href} trail={[root]} className="entry folder">
                {root.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
