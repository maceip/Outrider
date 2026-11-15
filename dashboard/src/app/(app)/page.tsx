import {DashboardPage} from "../../views/dashboard-page";
import {WwwShowcasePage} from "../../views/www-showcase-page";

const IS_WWW = process.env.NEXT_PUBLIC_WWW === "1";

export default function Page() {
  if (IS_WWW) {
    return <WwwShowcasePage />;
  }

  return <DashboardPage />;
}
