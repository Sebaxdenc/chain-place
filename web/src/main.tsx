import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Falta #root en index.html");

// Deliberadamente SIN StrictMode.
//
// En desarrollo, StrictMode monta cada efecto dos veces para ayudarte a
// detectar fugas. Aquí eso significaría dos conexiones WebSocket y dos
// Painters, y el segundo Painter leería el mismo nonce que el primero: dos
// transacciones con el mismo nonce, una de ellas rechazada. Los bugs que
// StrictMode destapa no compensan depurar conflictos de nonce fantasma.
createRoot(container).render(<App />);
