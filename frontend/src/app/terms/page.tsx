import type { Metadata } from 'next';
import LegalDocument, { type LegalSection } from '@/components/Legal/LegalDocument';

export const metadata: Metadata = {
	title: 'Terms of Service | RacketDiction',
	description: 'The rules for buying, selling and communicating on RacketDiction.',
};

// Section order and shape only. The wording lives in i18n/messages/*.json
// under the `terms.*` keys — see LegalDocument for the key layout.
const SECTIONS: LegalSection[] = [
	{ key: 'acceptance', paragraphs: 2 },
	{ key: 'eligibility', paragraphs: 1, bullets: 3 },
	{ key: 'account', paragraphs: 2, bullets: 3 },
	{ key: 'listings', paragraphs: 2, bullets: 4 },
	{ key: 'prohibited', paragraphs: 1, bullets: 6 },
	{ key: 'orders', paragraphs: 3 },
	{ key: 'content', paragraphs: 2 },
	{ key: 'messaging', paragraphs: 2 },
	{ key: 'ai', paragraphs: 2 },
	{ key: 'devapi', paragraphs: 1, bullets: 4 },
	{ key: 'suspension', paragraphs: 2 },
	{ key: 'liability', paragraphs: 3 },
	{ key: 'changes', paragraphs: 1 },
	{ key: 'contact', paragraphs: 1 },
];

export default function TermsPage() {
	return <LegalDocument ns="terms" sections={SECTIONS} />;
}
