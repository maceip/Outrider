import { Route, Routes } from "react-router-dom";
import { SiteFrame } from "@/components/site-frame";
import { FilmRoute } from "@/pages/film-page";
import { HomePage } from "@/pages/home";

export default function App() {
  return (
    <SiteFrame>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/:slug" element={<FilmRoute />} />
      </Routes>
    </SiteFrame>
  );
}
