import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import {
  ARButton,
  XR,
  XRDomOverlay,
  createXRStore,
  useXRHitTest,
} from "@react-three/xr";
import { Matrix4, Vector3 } from "three";
import {
  Box,
  CheckCircle2,
  Clock3,
  Crosshair,
  Move3D,
  Ruler,
  ScanLine,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import "./styles.css";

const HISTORY_KEY = "logicube:recent-calculations";
const TRACKABLE_TYPES = ["plane", "mesh", "point"];
const MEASUREMENT_STEPS = ["Canto base", "Comprimento", "Largura", "Topo"];

const xrStore = createXRStore({
  offerSession: false,
  emulate: false,
  hitTest: "required",
  domOverlay: true,
  planeDetection: true,
  meshDetection: true,
  anchors: false,
  handTracking: false,
  layers: false,
});

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 3)));
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  }).format(new Date(timestamp));
}

function calculateFreight(dimensions) {
  const { length, width, height } = dimensions;
  const cubicCentimeters = length * width * height;

  // Volume logistico em metros cubicos: medidas em cm divididas por 1.000.000.
  const cubicVolume = cubicCentimeters / 1_000_000;

  // Peso cubado rodoviario de e-commerce: volume em cm3 dividido pelo fator 6000.
  const cubedWeight = cubicCentimeters / 6000;

  // Frete simulado: taxa base fixa + adicional proporcional ao peso cubado.
  const freight = 15 + cubedWeight * 1.5;

  return {
    ...dimensions,
    cubicVolume,
    cubedWeight,
    freight,
    createdAt: Date.now(),
    id: crypto.randomUUID(),
  };
}

function calculateDimensionsFromPoints(points) {
  const [origin, lengthPoint, widthPoint, heightPoint] = points;
  const length = Math.max(1, Math.round(origin.distanceTo(lengthPoint) * 100));
  const width = Math.max(1, Math.round(origin.distanceTo(widthPoint) * 100));
  const verticalHeight = Math.abs(heightPoint.y - origin.y);
  const directHeight = origin.distanceTo(heightPoint);
  const heightMeters = verticalHeight > 0.015 ? verticalHeight : directHeight;
  const height = Math.max(1, Math.round(heightMeters * 100));

  return { length, width, height };
}

function useXRSessionActive(store) {
  const [active, setActive] = useState(() => Boolean(store.getState().session));

  useEffect(() => {
    return store.subscribe((state) => setActive(Boolean(state.session)));
  }, [store]);

  return active;
}

function Metric({ label, value, tone = "default" }) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SurfaceReticle({ hitPointRef, hitReadyRef, onReadyChange }) {
  const reticleRef = useRef(null);
  const matrix = useMemo(() => new Matrix4(), []);
  const readyStateRef = useRef(false);

  useXRHitTest((results, getWorldMatrix) => {
    if (!reticleRef.current) return;

    if (results.length === 0) {
      reticleRef.current.visible = false;
      if (readyStateRef.current) {
        readyStateRef.current = false;
        hitReadyRef.current = false;
        onReadyChange(false);
      }
      return;
    }

    const hasMatrix = getWorldMatrix(matrix, results[0]);
    if (!hasMatrix) return;

    reticleRef.current.visible = true;
    reticleRef.current.matrix.copy(matrix);
    hitPointRef.current.setFromMatrixPosition(matrix);

    if (!readyStateRef.current) {
      readyStateRef.current = true;
      hitReadyRef.current = true;
      onReadyChange(true);
    }
  }, "viewer", TRACKABLE_TYPES);

  return (
    <group ref={reticleRef} matrixAutoUpdate={false} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.055, 0.07, 56]} />
        <meshBasicMaterial color="#0071e3" transparent opacity={0.92} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.018, 32]} />
        <meshBasicMaterial color="#6bd995" transparent opacity={0.88} />
      </mesh>
    </group>
  );
}

function PlacedPoints({ points }) {
  return (
    <>
      {points.map((point, index) => (
        <group key={`${point.x}-${point.y}-${point.z}-${index}`} position={point}>
          <mesh>
            <sphereGeometry args={[0.025, 24, 24]} />
            <meshBasicMaterial color={index === 3 ? "#6bd995" : "#0071e3"} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function MeasurementOverlay({ points, reticleReady, onMarkPoint, onCancel }) {
  const nextStep = MEASUREMENT_STEPS[points.length] || "Finalizando";
  const progress = `${points.length}/4`;

  return (
    <XRDomOverlay className="xr-dom-overlay">
      <div className="ar-overlay-top">
        <div>
          <span className="ar-kicker">LogiCube AR</span>
          <strong>{nextStep}</strong>
        </div>
        <button className="ar-icon-button" onClick={onCancel} aria-label="Encerrar AR">
          <XCircle size={22} />
        </button>
      </div>

      <div className="ar-overlay-bottom">
        <div className="ar-progress" aria-label="Progresso da medição">
          {MEASUREMENT_STEPS.map((step, index) => (
            <span
              className={index < points.length ? "done" : index === points.length ? "current" : ""}
              key={step}
            />
          ))}
          <small>{progress}</small>
        </div>

        <button
          className="ar-mark-button"
          disabled={!reticleReady || points.length >= 4}
          onClick={onMarkPoint}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Crosshair size={21} />
          {reticleReady ? "Marcar ponto" : "Procurando superfície"}
        </button>
      </div>
    </XRDomOverlay>
  );
}

function ARExperience({
  active,
  points,
  reticleReady,
  hitPointRef,
  hitReadyRef,
  onReadyChange,
  onMarkPoint,
  onCancel,
}) {
  return (
    <section className={`ar-stage ${active ? "active" : ""}`} aria-hidden={!active}>
      <Canvas
        camera={{ fov: 70, position: [0, 1.6, 0] }}
        gl={{ alpha: true, antialias: true }}
        onPointerDown={active ? onMarkPoint : undefined}
      >
        <XR store={xrStore}>
          <ambientLight intensity={1.2} />
          <SurfaceReticle
            hitPointRef={hitPointRef}
            hitReadyRef={hitReadyRef}
            onReadyChange={onReadyChange}
          />
          <PlacedPoints points={points} />
          <MeasurementOverlay
            points={points}
            reticleReady={reticleReady}
            onMarkPoint={onMarkPoint}
            onCancel={onCancel}
          />
        </XR>
      </Canvas>
    </section>
  );
}

function ResultCard({ result }) {
  if (!result) {
    return (
      <section className="empty-result">
        <div className="empty-icon">
          <Ruler size={22} />
        </div>
        <div>
          <h2>Pronto para medir</h2>
          <p>Ative AR no celular para medir a caixa e calcular o frete por cubagem.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="result-card" aria-live="polite">
      <span className="section-label">Resultado atual</span>
      <div className="price-line">
        <div>
          <p>Valor do Frete</p>
          <strong>{formatCurrency(result.freight)}</strong>
        </div>
        <div className="success-badge">
          <CheckCircle2 size={16} />
          calculado
        </div>
      </div>

      <div className="metrics-grid">
        <Metric label="Dimensões" value={`${result.length} x ${result.width} x ${result.height} cm`} />
        <Metric label="Volume cúbico" value={`${result.cubicVolume.toFixed(4)} m³`} />
        <Metric label="Peso cubado" value={`${result.cubedWeight.toFixed(2)} kg`} />
        <Metric label="Fator" value="6000" tone="muted" />
      </div>
    </section>
  );
}

function HistoryList({ history }) {
  return (
    <section className="history-section">
      <div className="section-title">
        <div>
          <span className="section-label">Histórico recente</span>
          <h2>Últimos fretes calculados</h2>
        </div>
        <Clock3 size={18} />
      </div>

      {history.length === 0 ? (
        <div className="history-empty">Os 3 cálculos mais recentes aparecerão aqui.</div>
      ) : (
        <div className="history-list">
          {history.map((item) => (
            <article className="history-item" key={item.id}>
              <div className="history-main">
                <span>
                  {item.length} x {item.width} x {item.height} cm
                </span>
                <strong>{formatCurrency(item.freight)}</strong>
              </div>
              <div className="history-meta">
                <span>{item.cubicVolume.toFixed(4)} m³</span>
                <span>{item.cubedWeight.toFixed(2)} kg cubado</span>
                <span>{formatDate(item.createdAt)}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function App() {
  const [history, setHistory] = useState(loadHistory);
  const [latestResult, setLatestResult] = useState(history[0] || null);
  const [measurementPoints, setMeasurementPoints] = useState([]);
  const [reticleReady, setReticleReady] = useState(false);
  const [arError, setArError] = useState("");
  const hitPointRef = useRef(new Vector3());
  const hitReadyRef = useRef(false);
  const isARSessionActive = useXRSessionActive(xrStore);
  const isSecureContext = typeof window !== "undefined" ? window.isSecureContext : false;

  const summary = useMemo(() => {
    const averageFreight =
      history.length > 0
        ? history.reduce((total, item) => total + item.freight, 0) / history.length
        : 0;

    return {
      count: history.length,
      averageFreight,
    };
  }, [history]);

  useEffect(() => {
    if (!isARSessionActive) {
      setMeasurementPoints([]);
      setReticleReady(false);
      hitReadyRef.current = false;
    }
  }, [isARSessionActive]);

  function persistResult(result) {
    const nextHistory = [result, ...history].slice(0, 3);
    setLatestResult(result);
    setHistory(nextHistory);
    saveHistory(nextHistory);
  }

  function endARSession() {
    const session = xrStore.getState().session;
    if (session) {
      session.end().catch(() => undefined);
    }
  }

  function handleCancelAR() {
    setMeasurementPoints([]);
    endARSession();
  }

  function handleMarkPoint() {
    if (!isARSessionActive || !hitReadyRef.current || measurementPoints.length >= 4) return;

    const point = hitPointRef.current.clone();
    const nextPoints = [...measurementPoints, point];
    setMeasurementPoints(nextPoints);

    if (nextPoints.length === 4) {
      const dimensions = calculateDimensionsFromPoints(nextPoints);
      const result = calculateFreight(dimensions);
      persistResult(result);
      endARSession();
    }
  }

  return (
    <>
      <main className="app-shell">
        <section className="hero-panel">
          <nav className="top-bar" aria-label="Aplicativo">
            <div className="brand-mark">
              <Box size={21} />
            </div>
            <div>
              <span>LogiCube</span>
              <small>Frete Inteligente por Cubagem</small>
            </div>
          </nav>

          <div className="hero-content">
            <div>
              <span className="section-label">Dashboard mobile</span>
              <h1>Medir caixa com AR.</h1>
              <p>
                Use WebXR no celular para mapear superfícies, capturar dimensões reais e calcular
                frete.
              </p>
            </div>

            <div className="ar-cta-block">
              <ARButton
                className="primary-action hero-action xr-start-button"
                disabled={!isSecureContext}
                onError={(error) =>
                  setArError(error?.message || "Não foi possível iniciar a sessão WebXR.")
                }
                store={xrStore}
              >
                {(status) => (
                  <>
                    <ScanLine size={22} />
                    {!isSecureContext
                      ? "Abrir em HTTPS para usar AR"
                      : status === "unsupported"
                        ? "AR indisponível neste aparelho"
                        : status === "entered"
                          ? "Sessão AR ativa"
                          : "Medir Caixa em AR"}
                  </>
                )}
              </ARButton>

              <div className="secure-note">
                <ShieldCheck size={16} />
                <span>WebXR requer HTTPS em produção.</span>
              </div>

              {arError && <p className="ar-error">{arError}</p>}
            </div>
          </div>

          <div className="summary-strip" aria-label="Resumo dos cálculos">
            <Metric label="Cálculos salvos" value={summary.count} />
            <Metric
              label="Média recente"
              value={summary.count > 0 ? formatCurrency(summary.averageFreight) : "R$ 0,00"}
              tone="green"
            />
          </div>
        </section>

        <section className="ar-readiness">
          <div className="readiness-icon">
            <Move3D size={21} />
          </div>
          <div>
            <span className="section-label">WebXR Device API</span>
            <p>
              O app usa hit-test para posicionar a retícula em superfícies físicas e extrair as
              medidas em centímetros.
            </p>
          </div>
        </section>

        <ResultCard result={latestResult} />
        <HistoryList history={history} />
      </main>

      <ARExperience
        active={isARSessionActive}
        points={measurementPoints}
        reticleReady={reticleReady}
        hitPointRef={hitPointRef}
        hitReadyRef={hitReadyRef}
        onReadyChange={setReticleReady}
        onMarkPoint={handleMarkPoint}
        onCancel={handleCancelAR}
      />
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
