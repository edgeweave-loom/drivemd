import { Link } from "./Link.tsx";
import { hrefOf, type Crumb } from "./router.ts";

const HOME = hrefOf({ name: "home" });

/**
 * Where the page sits: Home, then each step of the path to it, which ends
 * at the page itself and so is left out.
 */
export function Breadcrumbs({ path }: { path: Crumb[] | undefined }) {
  const ancestors = path?.slice(0, -1) ?? [];
  return (
    <nav aria-label="Breadcrumbs" className="crumbs">
      <ol>
        <li>
          <Link to={HOME}>Home</Link>
        </li>
        {ancestors.map((crumb, index) => (
          // A path cut short can hold the same folder twice.
          <li key={index}>
            <Link to={crumb.href} trail={ancestors.slice(0, index + 1)}>
              {crumb.name}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
