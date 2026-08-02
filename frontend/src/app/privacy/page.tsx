import type { Metadata } from 'next';
import LegalDocument, { type LegalSection } from '@/components/Legal/LegalDocument';

export const metadata: Metadata = {
	title: 'Privacy Policy | RacketDiction',
	description: 'What personal data RacketDiction collects, why, and the control you have over it.',
};

// Section order and shape only. The wording lives in i18n/messages/*.json
// under the `privacy.*` keys — see LegalDocument for the key layout.
const SECTIONS: LegalSection[] = [
	{ key: 'scope', paragraphs: 2 },
	{ key: 'collect', paragraphs: 1, bullets: 7 },
	{ key: 'use', paragraphs: 1, bullets: 6 },
	{ key: 'sharing', paragraphs: 1, bullets: 3 },
	{ key: 'processors', paragraphs: 1, bullets: 4 },
	{ key: 'ai', paragraphs: 2 },
	{ key: 'cookies', paragraphs: 2, bullets: 2 },
	{ key: 'retention', paragraphs: 2 },
	{ key: 'security', paragraphs: 2, bullets: 4 },
	{ key: 'rights', paragraphs: 2, bullets: 5 },
	{ key: 'children', paragraphs: 1 },
	{ key: 'changes', paragraphs: 1 },
	{ key: 'contact', paragraphs: 1 },
];

export default function PrivacyPage() {
	return <LegalDocument ns="privacy" sections={SECTIONS} />;
}
