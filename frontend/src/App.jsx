import { useEffect, useState } from "react";
import style from "./components/assets/App.module.css";
import Prompt from "./components/Prompt.jsx";
import InpaintEditor from "./components/InpaintEditor.jsx";
import MetricsDashboard from "./components/MetricsDashboard.jsx";
import RecentImages from "./components/RecentImages.jsx";
import AccessGate from "./components/AccessGate.jsx";
import { GALLERY_EVENT, getImages } from "./utils/imageGallery";
import { APP_KEY_STORAGE, METRICS_KEY_STORAGE } from "./utils/apiClient";

const TABS = [
  { id: "generate", label: "Generate" },
  { id: "inpaint", label: "Inpaint" },
  { id: "metrics", label: "Metrics" },
];

const ACTIVE_TAB_KEY = "igen_active_tab";
const VALID_TAB_IDS = TABS.map((t) => t.id);

function App() {
  const [activeTab, setActiveTabState] = useState(() => {
    const stored = localStorage.getItem(ACTIVE_TAB_KEY);
    return VALID_TAB_IDS.includes(stored) ? stored : "generate";
  });

  // Persist alongside the state change rather than in a separate effect,
  // so every setActiveTab call (including the tab buttons below) writes
  // through -- same reasoning as the image gallery: React state alone
  // never survives a reload.
  function setActiveTab(tab) {
    setActiveTabState(tab);
    localStorage.setItem(ACTIVE_TAB_KEY, tab);
  }
  // Most recent successful generation, offered to the Inpaint tab as a
  // starting image -- the one piece of state genuinely shared across
  // tabs, so it's lifted here rather than duplicated. Seeded from the
  // persisted gallery (not null) so a reload doesn't lose it -- React
  // state alone never survives a reload, only localStorage does.
  const [lastImage, setLastImage] = useState(() => getImages()[0]?.dataUrl ?? null);
  const [galleryImages, setGalleryImages] = useState(() => getImages());

  // The gallery is written to from inside Prompt/InpaintEditor's hook
  // instances, not through a prop -- listen for the same-tab custom event
  // imageGallery.js fires on every save so this strip stays live without
  // threading a callback through every component that can produce an image.
  useEffect(() => {
    const handler = () => setGalleryImages(getImages());
    window.addEventListener(GALLERY_EVENT, handler);
    return () => window.removeEventListener(GALLERY_EVENT, handler);
  }, []);

  function sendToInpaint(image) {
    setLastImage(image);
    setActiveTab("inpaint");
  }

  return (
    <div className={style.appContainer}>
      <div className={style.app}>
        <h1 className={style.head}>IGen</h1>
        <p className={style.tail}>Enter prompt to generate</p>

        <AccessGate scope="app" storageKey={APP_KEY_STORAGE} title="Enter access key">
          <nav className={style.tabNav}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`${style.tabButton} ${activeTab === tab.id ? style.tabActive : ""}`}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {activeTab !== "metrics" && (
            <RecentImages images={galleryImages} onSelect={sendToInpaint} />
          )}

          {activeTab === "generate" && <Prompt onSendToInpaint={sendToInpaint} />}
          {activeTab === "inpaint" && <InpaintEditor initialImage={lastImage} />}
          {activeTab === "metrics" && (
            <AccessGate scope="metrics" storageKey={METRICS_KEY_STORAGE} title="Enter metrics key">
              <MetricsDashboard />
            </AccessGate>
          )}
        </AccessGate>
      </div>
    </div>
  );
}

export default App;
