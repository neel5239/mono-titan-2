import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LangProvider } from './i18n';
import { HealthProvider } from './hooks/useHealth';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { Screen } from './pages/Screen';
import { Records } from './pages/Records';
import { RecordDetail } from './pages/RecordDetail';
import { SecondLook } from './pages/SecondLook';
import { Dashboard } from './pages/Dashboard';
import { About } from './pages/About';

export default function App() {
  return (
    <LangProvider>
      <HealthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Home />} />
              <Route path="/screen" element={<Screen />} />
              <Route path="/records" element={<Records />} />
              <Route path="/records/:id" element={<RecordDetail />} />
              <Route path="/second-look" element={<SecondLook />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/about" element={<About />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </HealthProvider>
    </LangProvider>
  );
}
