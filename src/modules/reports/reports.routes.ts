import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validation.middleware';
import { toCsvBuffer, toXlsxBuffer } from '../../utils/exporters';
import { BadRequestError, UnauthorizedError } from '../../utils/errors';
import { buildActivityReport, buildAttendanceReport, buildStaffReport, buildTasksReport, type ReportData } from './reports.service';
import { reportQuerySchema, reportTypeParamSchema, type ReportQueryInput, type ReportTypeParam } from './reports.validation';

const BUILDERS: Record<ReportTypeParam['type'], (query: ReportQueryInput, req: Request) => Promise<ReportData>> = {
  tasks: (query) => buildTasksReport(query),
  staff: (query) => buildStaffReport(query),
  activity: (query) => buildActivityReport(query),
  attendance: (query, req) => {
    if (!req.authUser) throw new UnauthorizedError();
    return buildAttendanceReport(query, req.authUser);
  },
};

const downloadReportHandler = asyncHandler(
  async (req: Request<ReportTypeParam, unknown, unknown, ReportQueryInput>, res: Response) => {
    const builder = BUILDERS[req.params.type];
    if (!builder) throw new BadRequestError('Unknown report type');

    const report = await builder(req.query, req);
    const timestamp = new Date().toISOString().slice(0, 10);
    const baseFilename = report.finalFilename ? report.filename : `${report.filename}-${timestamp}`;

    if (req.query.format === 'csv') {
      const buffer = toCsvBuffer(report);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseFilename}.csv"`);
      res.send(buffer);
      return;
    }

    const buffer = await toXlsxBuffer(report);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${baseFilename}.xlsx"`);
    res.send(buffer);
  },
);

const router = Router();
router.use(requireAuth, requireAdmin);

router.get(
  '/:type',
  validate(reportTypeParamSchema, 'params'),
  validate(reportQuerySchema, 'query'),
  downloadReportHandler,
);

export default router;
