"use client";

import { useEffect, useState } from "react";

const WORDS = [
	"safely",
	"privately",
	"effortlessly",
	"conveniently",
	"on a budget",
	"sustainably",
];
const WORD_HEIGHT = 42;
const INTERVAL_MS = 2200;
const TRANSITION_MS = 500;

export function TypingTagline() {
	const [wordIndex, setWordIndex] = useState(0);
	const [isResetting, setIsResetting] = useState(false);

	useEffect(() => {
		const id = setInterval(() => {
			setWordIndex((i) => i + 1);
		}, INTERVAL_MS);
		return () => clearInterval(id);
	}, []);

	useEffect(() => {
		if (wordIndex < WORDS.length) return;
		// Wait for the swipe-up transition to fully complete before resetting
		const t = setTimeout(() => {
			setIsResetting(true);
			requestAnimationFrame(() => {
				setWordIndex(0);
				requestAnimationFrame(() => {
					requestAnimationFrame(() => setIsResetting(false));
				});
			});
		}, TRANSITION_MS);
		return () => clearTimeout(t);
	}, [wordIndex]);

	return (
		<div className="tagline-wrap">
			<h1 className="tagline-heading">
				Get home <span className="tagline-heading-keep">with Hop</span>
			</h1>
			<div className="tagline-flip-line">
				<span className="tagline-word-slot">
					<span
						className={`tagline-word-track ${isResetting ? "no-transition" : ""}`}
						style={{
							transform: `translateY(-${wordIndex * WORD_HEIGHT}px)`,
						}}
					>
						{[...WORDS, ...WORDS].map((word, i) => (
							<span key={`slot-${i}`} className="tagline-word">
								{word}
							</span>
						))}
					</span>
				</span>
			</div>
			<p className="tagline-sub">
				Ride-share with students headed your way.
			</p>
		</div>
	);
}
