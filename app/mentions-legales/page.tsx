import LegalPage, { legalMetadata } from '../legal-page';

export const generateMetadata = () => legalMetadata('notice');

export default function Page() {
  return <LegalPage kind="notice" />;
}
