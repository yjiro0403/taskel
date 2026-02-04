import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const docsDirectory = path.join(process.cwd(), 'src/content/docs');

export interface DocPost {
    slug: string;
    meta: {
        title: string;
        description?: string;
        order?: number;
    };
    content: string;
}

export function getAllDocs(): DocPost[] {
    if (!fs.existsSync(docsDirectory)) {
        return [];
    }
    const fileNames = fs.readdirSync(docsDirectory);
    const allDocsData = fileNames
        .filter((fileName) => fileName.endsWith('.md'))
        .map((fileName) => {
            const slug = fileName.replace(/\.md$/, '');
            const fullPath = path.join(docsDirectory, fileName);
            const fileContents = fs.readFileSync(fullPath, 'utf8');
            const { data, content } = matter(fileContents);

            return {
                slug,
                meta: data as DocPost['meta'],
                content,
            };
        });

    // Sort by order
    return allDocsData.sort((a, b) => (a.meta.order ?? 999) - (b.meta.order ?? 999));
}

export function getDocBySlug(slug: string): DocPost | null {
    const fullPath = path.join(docsDirectory, `${slug}.md`);
    if (!fs.existsSync(fullPath)) {
        return null;
    }
    const fileContents = fs.readFileSync(fullPath, 'utf8');
    const { data, content } = matter(fileContents);

    return {
        slug,
        meta: data as DocPost['meta'],
        content,
    };
}
