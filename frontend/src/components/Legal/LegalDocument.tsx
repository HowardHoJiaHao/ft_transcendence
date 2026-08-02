'use client';

import Header from '@/components/Header/Header';
import { useI18n } from '@/context/LanguageContext';


// One numbered section of a legal document. The text itself lives in
// i18n/messages/{en,ms,zh}.json under `<ns>.<key>.*`, so a section declared as
// { key: 'account', paragraphs: 2, bullets: 3 } expects these keys:// 
//   terms.account.title
//   terms.account.p1   ← intro paragraph, rendered before the bullets
//   terms.account.b1 … b3
//   terms.account.p2   ← rendered after the bullets// 
// Paragraphs and bullets are numbered from 1 because `t()` can only resolve
// string keys — it cannot return a JSON array — so lists have to be flattened.

export type LegalSection = {
	key: string;
	paragraphs?: number;
	bullets?: number;
};

// Turns a count into [1, 2, … n] so JSX can map over the numbered keys.
function range(count: number | undefined): number[] {
	return Array.from({ length: count ?? 0 }, (_, index) => index + 1);
}

export default function LegalDocument({
	ns,
	sections,
}: {
	ns: string;
	sections: LegalSection[];
}) {
	const { t } = useI18n();

	return (
		<>
			<Header />
			<main className="container py-10">
				<article className="max-w-[820px] mx-auto">
					<h1 className="text-3xl font-bold text-[var(--dark)] mb-2">{t(`${ns}.title`)}</h1>
					<p className="text-sm text-[#777] mb-6">{t(`${ns}.updated`)}</p>

					<p className="text-[var(--dark)] leading-7 mb-6">{t(`${ns}.intro`)}</p>

					<aside className="border-l-4 border-[var(--primary)] bg-[#faf7f4] rounded-r p-4 mb-8">
						<p className="font-bold text-[var(--dark)] mb-1">{t(`${ns}.noticeTitle`)}</p>
						<p className="text-sm text-[#555] leading-6">{t(`${ns}.notice`)}</p>
					</aside>

					<nav aria-label={t(`${ns}.tocTitle`)} className="border border-[var(--border)] rounded p-4 mb-10">
						<p className="font-bold text-[var(--dark)] mb-2">{t(`${ns}.tocTitle`)}</p>
						<ol className="list-none p-0 m-0 grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-6 gap-y-1">
							{sections.map((section, index) => (
								<li key={section.key} className="text-sm">
									<a href={`#${section.key}`} className="text-[var(--primary)] no-underline hover:underline">
										{index + 1}. {t(`${ns}.${section.key}.title`)}
									</a>
								</li>
							))}
						</ol>
					</nav>

					{sections.map((section, index) => {
						const paragraphs = range(section.paragraphs);
						const [first, ...rest] = paragraphs;

						return (
							<section key={section.key} id={section.key} className="mb-8 scroll-mt-6">
								<h2 className="text-xl font-bold text-[var(--dark)] mb-3">
									{index + 1}. {t(`${ns}.${section.key}.title`)}
								</h2>

								{first !== undefined && (
									<p className="text-[var(--dark)] leading-7 mb-3">{t(`${ns}.${section.key}.p${first}`)}</p>
								)}

								{section.bullets ? (
									<ul className="list-disc pl-6 mb-3 grid gap-2">
										{range(section.bullets).map((bullet) => (
											<li key={bullet} className="text-[var(--dark)] leading-7">
												{t(`${ns}.${section.key}.b${bullet}`)}
											</li>
										))}
									</ul>
								) : null}

								{rest.map((paragraph) => (
									<p key={paragraph} className="text-[var(--dark)] leading-7 mb-3">
										{t(`${ns}.${section.key}.p${paragraph}`)}
									</p>
								))}
							</section>
						);
					})}
				</article>
			</main>
		</>
	);
}
