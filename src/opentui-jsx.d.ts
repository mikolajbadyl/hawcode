/// <reference types="@opentui/react/jsx-namespace" />

import type {
	BoxProps,
	TextProps,
	SpanProps,
	CodeProps,
	MarkdownProps,
	InputProps,
	TextareaProps,
	SelectProps,
	ScrollBoxProps,
	AsciiFontProps,
	TabSelectProps,
	LineNumberProps,
	LineBreakProps,
	LinkProps,
	DiffProps,
} from "@opentui/react/src/types/components.js";

type ReactNode = import("react").ReactNode;
type Key = import("react").Key;

declare namespace React {
	namespace JSX {
		interface IntrinsicElements {
			box: BoxProps & { children?: ReactNode; key?: Key };
			text: TextProps & { children?: ReactNode; key?: Key };
			span: SpanProps & { children?: ReactNode; key?: Key };
			code: CodeProps & { children?: ReactNode; key?: Key };
			markdown: MarkdownProps & { children?: ReactNode; key?: Key };
			input: InputProps & { children?: ReactNode; key?: Key };
			textarea: TextareaProps & { children?: ReactNode; key?: Key };
			select: SelectProps & { children?: ReactNode; key?: Key };
			scrollbox: ScrollBoxProps & { children?: ReactNode; key?: Key };
			"ascii-font": AsciiFontProps & { children?: ReactNode; key?: Key };
			"tab-select": TabSelectProps & { children?: ReactNode; key?: Key };
			"line-number": LineNumberProps & { children?: ReactNode; key?: Key };
			b: SpanProps & { children?: ReactNode; key?: Key };
			i: SpanProps & { children?: ReactNode; key?: Key };
			u: SpanProps & { children?: ReactNode; key?: Key };
			strong: SpanProps & { children?: ReactNode; key?: Key };
			em: SpanProps & { children?: ReactNode; key?: Key };
			br: LineBreakProps & { key?: Key };
			a: LinkProps & { children?: ReactNode; key?: Key };
			diff: DiffProps & { children?: ReactNode; key?: Key };
		}
	}
}
