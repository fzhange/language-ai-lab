import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function MentorAnswer({ text }: { text: string }) {
  return <div className="mentor-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    // Model output is learning content, never executable HTML or remote media.
    img: () => null,
    a: ({ children }) => <span>{children}</span>,
  }}>{text}</Markdown></div>
}
