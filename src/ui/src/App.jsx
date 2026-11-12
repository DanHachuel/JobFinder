import { Routes, Route, Navigate } from 'react-router-dom';

import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Postagens from './pages/Postagens.jsx';
import Agendar from './pages/Agendar.jsx';
import Conexoes from './pages/Conexoes.jsx';
import DmCascades from './pages/DmCascades.jsx';
import Vagas from './pages/Vagas.jsx';
import Candidaturas from './pages/Candidaturas.jsx';
import Integracoes from './pages/Integracoes.jsx';
import ConfigPage from './pages/Config.jsx';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/postagens" element={<Postagens />} />
        <Route path="/postagens/agendar" element={<Agendar />} />
        <Route path="/conexoes" element={<Conexoes />} />
        <Route path="/conexoes/dm" element={<DmCascades />} />
        <Route path="/vagas" element={<Vagas />} />
        <Route path="/vagas/candidaturas" element={<Candidaturas />} />
        <Route path="/integracoes" element={<Integracoes />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
