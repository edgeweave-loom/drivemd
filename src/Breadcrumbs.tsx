import { Icon } from "./Icon.tsx";
import { useLayout } from "./layout.ts";
import { Link } from "./Link.tsx";
import { hrefOf, type Crumb } from "./router.ts";

const HOME = hrefOf({ name: "home" });

/**
 * Where the page sits: each step of the path to it, which ends at the page
 * itself, after Home on a phone, which has no drawer or rail to lead there.
 */
export function Breadcrumbs({ path }: { path: Crumb[] | undefined }) {
  const phone = useLayout() === "phone";
  const steps = path ?? [];
  return (
    <nav aria-label="Breadcrumbs" className="crumbs">
      <ol>
        {phone && (
          <li>
            <Link to={HOME}>Home</Link>
          </li>
        )}
        {steps.map((crumb, index) => (
          // A path cut short can hold the same folder twice.
          <li key={index}>
            {(phone || index > 0) && <Icon name="chevron_right" />}
            {index === steps.length - 1 ? (
              <span aria-current="page">{crumb.name}</span>
            ) : (
              <Link to={crumb.href} trail={steps.slice(0, index + 1)}>
                {crumb.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
