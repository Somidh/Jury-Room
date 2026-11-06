// The first screen: the files on the desk, before the jury room opens.
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

type CaseCard = { id: string; kind: string; title: string; charge: string; teaser: string };

/** Files dropped on a desk never land square. */
const TILTS = [-1.6, 1.1, -0.7, 1.5, -1.2];

export function CaseDesk() {
  const [cases, setCases] = useState<CaseCard[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/cases')
      .then((response) => (response.ok ? (response.json() as Promise<CaseCard[]>) : Promise.reject(new Error())))
      .then(setCases)
      .catch(() => setError('The case files could not be opened. Check that the server is running.'));
  }, []);

  async function pick(id: string) {
    setPicked(id);
    const response = await fetch('/api/trial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId: id }),
    }).catch(() => null);
    if (!response?.ok) {
      setPicked(null);
      setError('That file could not be opened. Check that the server is running.');
    }
  }

  return (
    <main className="desk">
      <header className="desk-head">
        <h1>Choose a case</h1>
        <p>Eleven strangers are waiting. You will be the twelfth.</p>
      </header>
      {error && <p role="alert" className="error desk-note">{error}</p>}
      <ul className="case-stack">
        {cases?.map((item, index) => (
          <motion.li
            key={item.id}
            initial={{ opacity: 0, y: 26, rotate: TILTS[index % TILTS.length]! * 3 }}
            animate={{
              opacity: picked && picked !== item.id ? 0.3 : 1,
              y: picked === item.id ? -10 : 0,
              rotate: picked === item.id ? 0 : TILTS[index % TILTS.length],
            }}
            whileHover={picked ? undefined : { y: -8, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 170, damping: 20, delay: picked ? 0 : index * 0.07 }}
          >
            <button className="case-card" disabled={picked !== null} onClick={() => void pick(item.id)}>
              <span className="case-tab">No. {String(index + 1).padStart(2, '0')} · {item.kind}</span>
              <h2>{item.title}</h2>
              <span className="case-charge">{item.charge}</span>
              <span className="case-teaser">{item.teaser}</span>
            </button>
          </motion.li>
        ))}
      </ul>
    </main>
  );
}
