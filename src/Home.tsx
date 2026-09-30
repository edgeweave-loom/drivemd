import { MY_DRIVE } from "./drive.ts";
import { Link } from "./Link.tsx";
import { hrefOf } from "./router.ts";

const ROOTS = [
  {
    name: "My Drive",
    href: hrefOf({ name: "folder", folder: { id: MY_DRIVE } }),
  },
];

export function Home() {
  return (
    <>
      <h2>Home</h2>
      <section aria-labelledby="roots">
        <h3 id="roots">Browse</h3>
        <ul className="entries">
          {ROOTS.map((root) => (
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
