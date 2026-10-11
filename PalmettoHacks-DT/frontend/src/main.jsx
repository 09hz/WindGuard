import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import SimulatorPage from "./simulator/SimulatorPage.jsx";
import { useActiveTab } from "./TabNav.jsx";
import "./index.css";

function Root() {
  const tab = useActiveTab();
  return tab === "simulator" ? <SimulatorPage /> : <App />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
