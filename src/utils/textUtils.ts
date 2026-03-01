export function chunkText(text: string, maxLength = 4000): string[] {
  const normalizedText = text.trim();

  if (!normalizedText) return [];
  if (normalizedText.length <= maxLength) return [normalizedText];

  const chunks: string[] = [];
  const paragraphs = normalizedText
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxLength) {
      chunks.push(paragraph);
      continue;
    }

    const sentences =
      paragraph.match(/[^.!?\n]+(?:[.!?]+|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) ||
      [paragraph];

    let currentChunk = '';

    const pushCurrentChunk = () => {
      if (!currentChunk) return;
      chunks.push(currentChunk.trim());
      currentChunk = '';
    };

    for (const sentence of sentences) {
      if (sentence.length > maxLength) {
        pushCurrentChunk();

        const words = sentence.split(/\s+/).filter(Boolean);
        let wordChunk = '';

        for (const word of words) {
          const candidate = wordChunk ? `${wordChunk} ${word}` : word;

          if (candidate.length > maxLength) {
            if (wordChunk) {
              chunks.push(wordChunk);
              wordChunk = '';
            }

            if (word.length > maxLength) {
              for (let i = 0; i < word.length; i += maxLength) {
                chunks.push(word.slice(i, i + maxLength));
              }
            } else {
              wordChunk = word;
            }
          } else {
            wordChunk = candidate;
          }
        }

        if (wordChunk) {
          chunks.push(wordChunk);
        }

        continue;
      }

      const candidate = currentChunk ? `${currentChunk} ${sentence}` : sentence;
      if (candidate.length > maxLength) {
        pushCurrentChunk();
        currentChunk = sentence;
      } else {
        currentChunk = candidate;
      }
    }

    pushCurrentChunk();
  }

  return chunks;
}
