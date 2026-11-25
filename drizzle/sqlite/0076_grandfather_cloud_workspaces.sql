-- A workspace with no settings row now runs on its own keys. Every workspace
-- that exists today predates that and keeps the deployment's keys.
INSERT INTO `workspace_settings` (`organization_id`, `mode`)
SELECT `id`, 'cloud' FROM `organization`
WHERE `id` NOT IN (SELECT `organization_id` FROM `workspace_settings`);
