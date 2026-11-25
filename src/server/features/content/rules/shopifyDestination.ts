import { ContentRefusal } from "./contentRefusal";

export function pickStoreBlog<B extends { id: string; handle: string }>(
  blogs: B[],
  blogId?: string,
): B {
  const blog = blogId
    ? blogs.find((item) => item.id === blogId)
    : (blogs.find((item) => item.handle === "news") ?? blogs[0]);
  if (!blog)
    throw new ContentRefusal(
      blogId
        ? "That blog no longer exists in the store."
        : "This store has no blog to publish into.",
    );
  return blog;
}
