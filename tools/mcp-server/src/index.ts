import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerHttpTools } from './tools/http.js'
import { registerJsonTools } from './tools/json.js'
import { registerMemoryTools } from './tools/memory.js'
import { registerQueueTools } from './tools/queue.js'
import { registerScratchpadTools } from './tools/scratchpad.js'
import { registerWbsTools } from './tools/wbs.js'
import { registerGitTools } from './tools/git.js'

const server = new McpServer({
  name: 'rvfs-mcp',
  version: '0.1.0',
})

registerHttpTools(server)
registerJsonTools(server)
registerWbsTools(server)
registerMemoryTools(server)
registerScratchpadTools(server)
registerQueueTools(server)
registerGitTools(server)

// stdio transport — NEVER write to stdout from here on; use stderr for diagnostics
const transport = new StdioServerTransport()
await server.connect(transport)
process.stderr.write('rvfs-mcp server started\n')
