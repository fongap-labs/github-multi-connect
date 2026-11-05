-- Per-client Resource and tool allowlists. New clients receive no MCP access
-- until an administrator explicitly grants both a Resource and its tools.
ALTER TABLE oauth_clients ADD COLUMN allowed_resources TEXT NOT NULL DEFAULT '[]';
ALTER TABLE oauth_clients ADD COLUMN allowed_tools TEXT NOT NULL DEFAULT '[]';

-- Preserve the existing permissions for already-approved clients. These are
-- the currently registered GitHub Resources and tool set; future tools are not
-- added to this legacy grant automatically.
UPDATE oauth_clients
SET allowed_resources='["default","github"]',
    allowed_tools='["github:github_available_owners","github:github_get_repository","github:github_list_issues","github:github_get_issue","github:github_list_pull_requests","github:github_get_pull_request","github:github_read_file","github:github_create_issue","github:github_operation_status"]'
WHERE approved=1;
