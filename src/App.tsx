import { ComingSoonPage } from './components/ComingSoonPage';
import { PwaUpdateBanner } from './components/PwaUpdateBanner';

export default function App() {
  return (
    <>
      <ComingSoonPage />
      <PwaUpdateBanner activeExamOpen={false} isDestActive={false} />
    </>
  );
}
