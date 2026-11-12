export async function listPublicBucketImages(prefix = ''): Promise<string[]> {
  return listImagesThroughApi(prefix);
}

export async function uploadImageToPublicBucket(file: Blob, filename: string): Promise<string> {
  return uploadImageThroughApi(file, filename);
}

async function listImagesThroughApi(prefix: string): Promise<string[]> {
  const response = await fetch(`/api/storage/images?prefix=${encodeURIComponent(prefix)}`, {
    credentials: 'include',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Public image library could not be loaded.');
  return Array.isArray(data.images) ? data.images : [];
}

async function uploadImageThroughApi(file: Blob, filename: string): Promise<string> {
  // Robust base64 conversion for larger files
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      if (base64) resolve(base64);
      else reject(new Error('Could not convert image to base64.'));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const response = await fetch('/api/storage/upload', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ filename, contentType: file.type || 'image/png', data })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.url) throw new Error(result.error || 'Image upload failed. Check Supabase storage credentials and bucket policies.');
  return result.url;
}

export interface StoredPost {
  id?: string;
  title: string;
  content: string;
  airline_name: string;
  city: string;
  created_at?: string;
}

export interface StoredBlogDraft {
  id: string;
  title?: string;
  keyword?: string;
  content?: string;
  content_html?: string;
  html_content?: string;
  banner_url?: string;
  image_url?: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface BlogRequestInput {
  id: string;
  blog_type: string;
  company_name: string;
  company_email: string;
  company_website: string;
  keyword: string;
  topic: string;
  tfn: string;
  status: 'pending';
  payload: Record<string, unknown>;
}

export async function getBlogTableDrafts(limit = 100): Promise<StoredBlogDraft[]> {
  const response = await fetch(`/api/workflow/drafts?limit=${Math.min(Math.max(limit, 1), 50)}`, {
    credentials: 'include',
    cache: 'no-store',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not load saved drafts.');
  return Array.isArray(result.drafts) ? result.drafts as StoredBlogDraft[] : [];
}

export async function createPendingBlogRequest(request: BlogRequestInput & { immediateBlog?: unknown }): Promise<BlogRequestInput & { immediateBlog?: unknown }> {
  const response = await fetch('/api/workflow/trigger', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success || !result.record) {
    throw new Error(result.error || 'Could not create the workflow request.');
  }
  return {
    ...(result.record as BlogRequestInput),
    immediateBlog: result.immediateBlog,
  };
}

export async function getBlogsForRequest(requestId: string): Promise<StoredBlogDraft[]> {
  const response = await fetch(`/api/workflow/status?requestId=${encodeURIComponent(requestId)}`, {
    credentials: 'include',
    cache: 'no-store',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not load workflow results.');
  return Array.isArray(result.blogs) ? result.blogs as StoredBlogDraft[] : [];
}

/**
 * Save a generated post to Supabase for future reference/variations
 */
export async function savePostToSupabase(post: StoredPost) {
  try {
    const key = 'easyflight_generated_posts';
    const saved = JSON.parse(localStorage.getItem(key) || '[]') as StoredPost[];
    const next = [{ ...post, id: post.id || crypto.randomUUID(), created_at: post.created_at || new Date().toISOString() }, ...saved].slice(0, 500);
    localStorage.setItem(key, JSON.stringify(next));
    return next[0];
  } catch (err) {
    console.error('Could not save generated post in this account workspace:', err);
    throw err;
  }
}

/**
 * Fetch old posts to help AI generate different content
 */
export async function getRecentPosts(airlineName: string, city: string, limit = 5) {
  try {
    const saved = JSON.parse(localStorage.getItem('easyflight_generated_posts') || '[]') as StoredPost[];
    return saved.filter((post) => post.airline_name === airlineName && post.city === city).slice(0, limit);
  } catch (err) {
    console.error('Could not read generated posts from this account workspace:', err);
    throw err;
  }
}
