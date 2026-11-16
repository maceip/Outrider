import {InterceptorSlot} from "../../views/interceptor-slot";
import {WwwLandingPage} from "../../views/www-landing-page";

const IS_WWW = process.env.NEXT_PUBLIC_WWW === "1";

export default function Page() {
  return IS_WWW ? <WwwLandingPage /> : <InterceptorSlot />;
}
