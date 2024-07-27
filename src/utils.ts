/**
 * Converts a string to a tag format.
 * 
 * @param title - The title to convert.
 * @returns The title converted to a tag format.
 */
export function formatForTag(title: string): string {
    // Remove leading '#' symbols and trim whitespace
    const trimmedTitle = title?.trim()?.replace(/^#+\s*/, '').trim();
    // Replace punctuation with underscores, keep all letters (including non-Latin) and numbers
    return trimmedTitle?.replace(/[^\p{L}\p{N}]+/gu, '_')?.toLowerCase()?.replace(/^_|_$/g, '');
}